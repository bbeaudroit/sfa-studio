import { alphaBounds, ctx2d, makeCanvas } from '../core/bitmap'
import {
  addShapeSilent, commitPatches, crop, editableRaster, grayOf, rasterOf, newShape, paintTarget, selectLayer, setSelection, shiftLayer,
  type PaintTarget,
} from '../core/ops'
import { applyAdjustment } from '../core/adjustments'
import { gaussianBlur, unsharp } from '../core/filters'
import { compositeDoc, flattenToCanvas, layerBounds, layerSource, shapeBox, textLayout, type LayerSource } from '../core/render'
import { floodMask, maskBounds, maskFromBytes, maskFromPath, type SelMode } from '../core/selection'
import {
  S, activeLayer, commit, editPixels, redrawOverlay, set, setDocSilent, toast, type ToolId, type ToolOptions,
} from '../core/store'
import type { Doc, Layer, Pt, RasterLayer, Rect, ShapeLayer, TextLayer } from '../core/types'
import { panBy, toDoc, toScreen, zoomStep } from '../core/view'

export interface PInfo {
  x: number
  y: number
  sx: number
  sy: number
  shift: boolean
  alt: boolean
  ctrl: boolean
  pressure: number
  pen: boolean
  dbl?: boolean
}

export interface Tool {
  cursor: (p: PInfo | null) => string
  down?(p: PInfo): void
  move?(p: PInfo): void
  up?(p: PInfo): void
  hover?(p: PInfo | null): void
  overlay?(g: CanvasRenderingContext2D, dpr: number): void
  key?(e: KeyboardEvent): boolean
  activate?(): void
  deactivate?(): void
}

const ACCENT = '#C6FF3D'
let hover: PInfo | null = null

// --- shared helpers ----------------------------------------------------------

function selMode(p: PInfo, fallback: SelMode): SelMode {
  if (p.shift && p.alt) return 'intersect'
  if (p.shift) return 'add'
  if (p.alt) return 'subtract'
  return fallback
}

function screenPath(g: CanvasRenderingContext2D, dpr: number, fn: (pt: (x: number, y: number) => [number, number]) => void) {
  const pt = (x: number, y: number): [number, number] => {
    const s = toScreen(x, y)
    return [s.x * dpr, s.y * dpr]
  }
  g.beginPath()
  fn(pt)
}

/** Dashed black/white stroke that reads on any background. */
function antStroke(g: CanvasRenderingContext2D, dpr: number) {
  g.lineWidth = dpr
  g.setLineDash([])
  g.strokeStyle = 'rgba(0,0,0,.8)'
  g.stroke()
  g.setLineDash([4 * dpr, 4 * dpr])
  g.strokeStyle = '#fff'
  g.stroke()
  g.setLineDash([])
}

function hitLayer(doc: Doc, x: number, y: number): Layer | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i]
    if (!l.visible || l.kind === 'adjust') continue
    const b = layerBounds(l, doc)
    if (x < b.x || y < b.y || x >= b.x + b.w || y >= b.y + b.h) continue
    if (l.kind === 'raster') {
      const px = Math.floor(x - l.x), py = Math.floor(y - l.y)
      const a = ctx2d(l.bmp.canvas, true).getImageData(px, py, 1, 1).data[3]
      if (a > 8) return l
      continue
    }
    return l
  }
  return null
}

function replaceLayer(d: Doc, l: Layer): Doc {
  return { ...d, layers: d.layers.map(x => (x.id === l.id ? l : x)) }
}

// --- Stroke engine: brush, eraser, clone, dodge/burn/sponge, blur/sharpen -----------

type PaintKind = 'brush' | 'eraser' | 'clone' | 'dodge' | 'focus'

interface Stroke {
  target: PaintTarget
  kind: PaintKind
  mode: 'paint' | 'erase' | 'source'
  stroke: HTMLCanvasElement
  work: HTMLCanvasElement
  /** For 'source' strokes: what gets painted in (clone / toned / blurred copy). */
  source: HTMLCanvasElement | null
  dab: HTMLCanvasElement
  color: string
  last: Pt
  bbox: Rect | null
  carry: number
  raf: number
}

let stroke: Stroke | null = null
const lastPaint: { pt: Pt | null; layerId: string | null } = { pt: null, layerId: null }
let cloneSrc: Pt | null = null
let cloneOff: Pt | null = null

function makeDab(size: number, hardness: number, color: string) {
  const d = Math.max(1, Math.ceil(size))
  const c = makeCanvas(d + 2, d + 2)
  const g = ctx2d(c)
  const r = d / 2, cx = r + 1
  if (hardness >= 0.99 || size < 3) {
    g.fillStyle = color
    g.beginPath()
    g.arc(cx, cx, Math.max(0.5, r), 0, Math.PI * 2)
    g.fill()
  } else {
    const grad = g.createRadialGradient(cx, cx, 0, cx, cx, r)
    grad.addColorStop(0, color)
    grad.addColorStop(Math.max(0.01, hardness), color)
    grad.addColorStop(1, color.length === 7 ? color + '00' : 'rgba(0,0,0,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, c.width, c.height)
  }
  return c
}

function stamp(s: Stroke, from: Pt, to: Pt, size: number) {
  const g = ctx2d(s.stroke)
  const spacing = Math.max(0.5, size * 0.1)
  const dx = to.x - from.x, dy = to.y - from.y
  const dist = Math.hypot(dx, dy)
  const half = s.dab.width / 2
  let t = s.carry
  if (dist === 0 && t === 0) {
    g.drawImage(s.dab, from.x - half, from.y - half)
  }
  while (t <= dist) {
    const k = dist === 0 ? 0 : t / dist
    const x = from.x + dx * k, y = from.y + dy * k
    g.drawImage(s.dab, x - half, y - half)
    t += spacing
  }
  s.carry = t - dist
  const r: Rect = { x: Math.min(from.x, to.x) - half - 1, y: Math.min(from.y, to.y) - half - 1, w: Math.abs(dx) + half * 2 + 2, h: Math.abs(dy) + half * 2 + 2 }
  s.bbox = s.bbox
    ? { x: Math.min(s.bbox.x, r.x), y: Math.min(s.bbox.y, r.y), w: Math.max(s.bbox.x + s.bbox.w, r.x + r.w) - Math.min(s.bbox.x, r.x), h: Math.max(s.bbox.y + s.bbox.h, r.y + r.h) - Math.min(s.bbox.y, r.y) }
    : r
}

/** Stroke buffer clipped to the selection, in target space. */
function maskedStroke(s: Stroke): HTMLCanvasElement {
  const sel = S().doc?.selection
  if (!sel) return s.stroke
  const c = makeCanvas(s.stroke.width, s.stroke.height)
  const g = ctx2d(c)
  g.drawImage(s.stroke, 0, 0)
  g.globalCompositeOperation = 'destination-in'
  g.drawImage(sel.canvas, -s.target.x, -s.target.y)
  return c
}

function strokeOpacity(s: Stroke) {
  const o = S().opts
  if (s.kind === 'dodge' || s.kind === 'focus') return 1
  return o[s.kind].opacity
}

/** Draws the stroke onto g, which already holds the target's pixels. */
function applyStroke(s: Stroke, g: CanvasRenderingContext2D) {
  const m = maskedStroke(s)
  g.globalAlpha = strokeOpacity(s)
  if (s.mode === 'source' && s.source) {
    const t = makeCanvas(m.width, m.height)
    const tg = ctx2d(t)
    tg.drawImage(s.source, 0, 0)
    tg.globalCompositeOperation = 'destination-in'
    tg.drawImage(m, 0, 0)
    g.drawImage(t, 0, 0)
  } else {
    g.globalCompositeOperation = s.mode === 'erase' ? 'destination-out' : 'source-over'
    g.drawImage(m, 0, 0)
  }
  g.globalAlpha = 1
  g.globalCompositeOperation = 'source-over'
}

function renderStroke(s: Stroke) {
  const g = ctx2d(s.work)
  g.globalCompositeOperation = 'copy'
  g.drawImage(s.target.bmp.canvas, 0, 0)
  g.globalCompositeOperation = 'source-over'
  applyStroke(s, g)
  const t = s.target
  set({ preview: t.isMask ? { layerId: t.layer.id, mask: s.work, maskX: t.x, maskY: t.y } : { layerId: t.layer.id, canvas: s.work, x: t.x, y: t.y } })
}

function schedule(s: Stroke) {
  if (s.raf) return
  s.raf = requestAnimationFrame(() => {
    s.raf = 0
    if (stroke === s) renderStroke(s)
  })
}

/** Tone curve for dodge / burn, weighted by tonal range. */
function toneCanvas(src: HTMLCanvasElement, o: ToolOptions['dodge']): HTMLCanvasElement {
  const img = ctx2d(src, true).getImageData(0, 0, src.width, src.height)
  const d = img.data
  const k = o.strength / 100
  if (o.mode === 'sponge' || o.mode === 'saturate') {
    applyAdjustment(d, { type: 'hue', hue: 0, saturation: (o.mode === 'saturate' ? 1 : -1) * k * 100, lightness: 0 })
  } else {
    const lut = new Uint8ClampedArray(256)
    for (let v = 0; v < 256; v++) {
      const t = v / 255
      const w = o.range === 'shadows' ? (1 - t) ** 2 : o.range === 'highlights' ? t ** 2 : 1 - Math.abs(t - 0.5) * 2
      lut[v] = o.mode === 'dodge' ? v + (255 - v) * k * w : v - v * k * w
    }
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lut[d[i]]
      d[i + 1] = lut[d[i + 1]]
      d[i + 2] = lut[d[i + 2]]
    }
  }
  const c = makeCanvas(src.width, src.height)
  ctx2d(c).putImageData(img, 0, 0)
  return c
}

function strokeSource(kind: PaintKind, t: PaintTarget, p: PInfo): HTMLCanvasElement | null {
  const src = t.bmp.canvas
  if (kind === 'dodge') return toneCanvas(src, S().opts.dodge)
  if (kind === 'focus') {
    const o = S().opts.focus
    const k = o.strength / 100
    return o.mode === 'blur' ? gaussianBlur(src, 0.5 + k * 6) : unsharp(src, 40 + k * 220, 1, 0)
  }
  if (kind === 'clone') {
    const o = S().opts.clone
    const off = o.aligned && cloneOff ? cloneOff : { x: cloneSrc!.x - p.x, y: cloneSrc!.y - p.y }
    cloneOff = off
    const c = makeCanvas(src.width, src.height)
    const g = ctx2d(c)
    if (o.sampleAll) g.drawImage(flattenToCanvas(S().doc!), -t.x - off.x, -t.y - off.y)
    else g.drawImage(src, -off.x, -off.y)
    return c
  }
  return null
}

const PAINT_LABEL: Record<PaintKind, string> = { brush: 'Brush', eraser: 'Eraser', clone: 'Clone stamp', dodge: 'Dodge', focus: 'Blur' }

function paintTool(kind: PaintKind): Tool {
  const o = () => S().opts[kind]
  const sizeAt = (p: PInfo) => Math.max(1, o().size * (p.pen ? Math.max(0.1, p.pressure) : 1))
  return {
    cursor: () => 'none',
    down(p) {
      if (kind === 'clone' && p.alt) {
        cloneSrc = { x: p.x, y: p.y }
        cloneOff = null
        toast('Clone source set')
        return
      }
      if (kind === 'clone' && !cloneSrc) return toast('Alt-click to set the clone source')
      const t = paintTarget()
      if (!t) return
      if (t.isMask && (kind === 'clone' || kind === 'dodge' || kind === 'focus')) return toast('This tool works on pixels, not masks')
      const { width: w, height: h } = t.bmp.canvas
      const mode = kind === 'brush' ? 'paint' : kind === 'eraser' ? (t.isMask ? 'paint' : 'erase') : 'source'
      const color = kind === 'brush' ? (t.isMask ? grayOf(S().fg) : S().fg) : kind === 'eraser' && t.isMask ? grayOf(S().bg) : mode === 'erase' ? '#000000' : '#ffffff'
      const s: Stroke = {
        target: t, kind, mode, color, stroke: makeCanvas(w, h), work: makeCanvas(w, h),
        source: mode === 'source' ? strokeSource(kind, t, p) : null,
        dab: makeDab(o().size, o().hardness, color), last: { x: p.x - t.x, y: p.y - t.y },
        bbox: null, carry: 0, raf: 0,
      }
      stroke = s
      const pt = { x: p.x - t.x, y: p.y - t.y }
      if (p.shift && lastPaint.pt && lastPaint.layerId === t.layer.id) stamp(s, { x: lastPaint.pt.x, y: lastPaint.pt.y }, pt, o().size)
      else stamp(s, pt, pt, sizeAt(p))
      s.last = pt
      renderStroke(s)
    },
    move(p) {
      const s = stroke
      if (!s) return
      const pt = { x: p.x - s.target.x, y: p.y - s.target.y }
      if (p.pen) s.dab = makeDab(sizeAt(p), o().hardness, s.color)
      stamp(s, s.last, pt, sizeAt(p))
      s.last = pt
      schedule(s)
    },
    up() {
      const s = stroke
      stroke = null
      if (!s) return
      cancelAnimationFrame(s.raf)
      lastPaint.pt = s.last
      lastPaint.layerId = s.target.layer.id
      const patch = editPixels(s.target.bmp, s.bbox, g => applyStroke(s, g))
      set({ preview: null })
      const label = kind === 'dodge' ? ({ dodge: 'Dodge', burn: 'Burn', sponge: 'Sponge', saturate: 'Sponge' } as const)[S().opts.dodge.mode] : kind === 'focus' ? (S().opts.focus.mode === 'blur' ? 'Blur' : 'Sharpen') : PAINT_LABEL[kind]
      commitPatches(s.target.isMask ? `${label} (mask)` : label, [patch])
    },
    hover() {
      redrawOverlay()
    },
    overlay(g, dpr) {
      if (!hover) return
      const z = S().view.zoom
      const r = Math.max(1, (o().size * z) / 2) * dpr
      const sx = hover.sx * dpr, sy = hover.sy * dpr
      g.beginPath()
      g.arc(sx, sy, r, 0, Math.PI * 2)
      g.lineWidth = dpr * 1.5
      g.strokeStyle = 'rgba(0,0,0,.6)'
      g.stroke()
      g.lineWidth = dpr
      g.strokeStyle = '#fff'
      g.stroke()
      if (r > 6 * dpr && o().hardness < 0.95) {
        g.beginPath()
        g.arc(sx, sy, r * Math.max(0.05, o().hardness), 0, Math.PI * 2)
        g.setLineDash([2 * dpr, 3 * dpr])
        g.strokeStyle = 'rgba(255,255,255,.55)'
        g.stroke()
        g.setLineDash([])
      }
      if (r < 4 * dpr) {
        g.fillStyle = '#fff'
        g.fillRect(sx - dpr, sy - dpr, 2 * dpr, 2 * dpr)
      }
      if (kind === 'clone' && cloneSrc) {
        // Where pixels are sampled from.
        const off = cloneOff ?? { x: cloneSrc.x - hover.x, y: cloneSrc.y - hover.y }
        const at = stroke || (S().opts.clone.aligned && cloneOff) ? toScreen(hover.x + off.x, hover.y + off.y) : toScreen(cloneSrc.x, cloneSrc.y)
        const cx = at.x * dpr, cy = at.y * dpr, k = 7 * dpr
        g.beginPath()
        g.moveTo(cx - k, cy); g.lineTo(cx + k, cy)
        g.moveTo(cx, cy - k); g.lineTo(cx, cy + k)
        g.lineWidth = 3 * dpr
        g.strokeStyle = 'rgba(0,0,0,.6)'
        g.stroke()
        g.lineWidth = 1.5 * dpr
        g.strokeStyle = ACCENT
        g.stroke()
      }
    },
  }
}

// --- Marquee -------------------------------------------------------------------

let marq: { a: Pt; b: Pt; mode: SelMode; square: boolean; center: boolean } | null = null

function marqRect(): Rect | null {
  if (!marq) return null
  let { x: ax, y: ay } = marq.a
  let dx = marq.b.x - ax, dy = marq.b.y - ay
  if (marq.square) {
    const m = Math.max(Math.abs(dx), Math.abs(dy))
    dx = Math.sign(dx || 1) * m
    dy = Math.sign(dy || 1) * m
  }
  if (marq.center) {
    ax -= dx
    ay -= dy
    dx *= 2
    dy *= 2
  }
  return { x: Math.round(Math.min(ax, ax + dx)), y: Math.round(Math.min(ay, ay + dy)), w: Math.round(Math.abs(dx)), h: Math.round(Math.abs(dy)) }
}

const marquee: Tool = {
  cursor: () => 'crosshair',
  down(p) {
    const mode = S().doc?.selection ? selMode(p, S().opts.marquee.mode) : 'new'
    marq = { a: { x: p.x, y: p.y }, b: { x: p.x, y: p.y }, mode, square: false, center: false }
  },
  move(p) {
    if (!marq) return
    marq.b = { x: p.x, y: p.y }
    // Modifiers pressed after the drag starts constrain instead of changing the mode.
    marq.square = p.shift && marq.mode !== 'add' && marq.mode !== 'intersect'
    marq.center = p.alt && marq.mode !== 'subtract' && marq.mode !== 'intersect'
    redrawOverlay()
  },
  up() {
    const r = marqRect()
    const m = marq
    marq = null
    redrawOverlay()
    const d = S().doc
    if (!d || !r || !m) return
    if (r.w < 2 || r.h < 2) {
      if (m.mode === 'new') setSelection(null)
      return
    }
    const path = new Path2D()
    if (S().opts.marquee.shape === 'ellipse') path.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2)
    else path.rect(r.x, r.y, r.w, r.h)
    setSelection(maskFromPath(d.width, d.height, path, S().opts.marquee.feather), m.mode, S().opts.marquee.shape === 'ellipse' ? 'Elliptical marquee' : 'Rectangular marquee')
  },
  overlay(g, dpr) {
    const r = marqRect()
    if (!r) return
    screenPath(g, dpr, pt => {
      const [x0, y0] = pt(r.x, r.y)
      const [x1, y1] = pt(r.x + r.w, r.y + r.h)
      if (S().opts.marquee.shape === 'ellipse') g.ellipse((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0, 0, Math.PI * 2)
      else g.rect(x0, y0, x1 - x0, y1 - y0)
    })
    antStroke(g, dpr)
    drawSizeTag(g, dpr, r)
  },
}

function drawSizeTag(g: CanvasRenderingContext2D, dpr: number, r: Rect) {
  if (!hover) return
  const text = `${Math.round(r.w)} × ${Math.round(r.h)}`
  g.font = `${11 * dpr}px "Geist Mono Variable", monospace`
  const w = g.measureText(text).width + 12 * dpr
  const x = hover.sx * dpr + 14 * dpr, y = hover.sy * dpr + 14 * dpr
  g.fillStyle = 'rgba(10,10,11,.9)'
  g.beginPath()
  g.roundRect(x, y, w, 20 * dpr, 6 * dpr)
  g.fill()
  g.fillStyle = '#fafafa'
  g.textBaseline = 'middle'
  g.fillText(text, x + 6 * dpr, y + 10 * dpr)
}

// --- Lasso --------------------------------------------------------------------

let lassoPts: Pt[] | null = null
let lassoMode: SelMode = 'new'
let polyActive = false

function finishLasso() {
  const d = S().doc
  const pts = lassoPts
  lassoPts = null
  polyActive = false
  redrawOverlay()
  if (!d || !pts || pts.length < 3) {
    if (lassoMode === 'new' && pts && pts.length < 3) setSelection(null)
    return
  }
  const path = new Path2D()
  path.moveTo(pts[0].x, pts[0].y)
  for (const q of pts.slice(1)) path.lineTo(q.x, q.y)
  path.closePath()
  setSelection(maskFromPath(d.width, d.height, path, S().opts.lasso.feather), lassoMode, 'Lasso')
}

const lasso: Tool = {
  cursor: () => 'crosshair',
  down(p) {
    const poly = S().opts.lasso.poly
    if (poly && polyActive && lassoPts) {
      const first = lassoPts[0]
      const near = Math.hypot((first.x - p.x) * S().view.zoom, (first.y - p.y) * S().view.zoom) < 8
      if (near || p.dbl) return finishLasso()
      lassoPts.push({ x: p.x, y: p.y })
      redrawOverlay()
      return
    }
    lassoMode = S().doc?.selection ? selMode(p, S().opts.lasso.mode) : 'new'
    lassoPts = [{ x: p.x, y: p.y }]
    polyActive = poly
  },
  move(p) {
    if (!lassoPts || polyActive) return
    const last = lassoPts[lassoPts.length - 1]
    if (Math.hypot(last.x - p.x, last.y - p.y) * S().view.zoom > 1.5) lassoPts.push({ x: p.x, y: p.y })
    redrawOverlay()
  },
  up() {
    if (!polyActive) finishLasso()
  },
  hover() {
    if (polyActive) redrawOverlay()
  },
  key(e) {
    if (!polyActive) return false
    if (e.key === 'Enter') { finishLasso(); return true }
    if (e.key === 'Escape') { lassoPts = null; polyActive = false; redrawOverlay(); return true }
    if (e.key === 'Backspace' && lassoPts && lassoPts.length > 1) { lassoPts.pop(); redrawOverlay(); return true }
    return false
  },
  deactivate() {
    lassoPts = null
    polyActive = false
  },
  overlay(g, dpr) {
    if (!lassoPts) return
    screenPath(g, dpr, pt => {
      lassoPts!.forEach((q, i) => {
        const [x, y] = pt(q.x, q.y)
        if (i) g.lineTo(x, y)
        else g.moveTo(x, y)
      })
      if (polyActive && hover) g.lineTo(hover.sx * dpr, hover.sy * dpr)
    })
    antStroke(g, dpr)
    if (polyActive) {
      const [x, y] = (() => { const s = toScreen(lassoPts![0].x, lassoPts![0].y); return [s.x * dpr, s.y * dpr] })()
      g.beginPath()
      g.arc(x, y, 4 * dpr, 0, Math.PI * 2)
      g.fillStyle = ACCENT
      g.fill()
    }
  },
}

// --- Magic wand ------------------------------------------------------------------

function sampleSource(d: Doc, all: boolean): ImageData {
  let c: HTMLCanvasElement
  if (all) c = flattenToCanvas(d)
  else {
    c = makeCanvas(d.width, d.height)
    const l = d.layers.find(x => x.id === d.activeId)
    const s = l && layerSource(l)
    if (s) ctx2d(c).drawImage(s.src, s.x, s.y)
  }
  return ctx2d(c, true).getImageData(0, 0, d.width, d.height)
}

const wand: Tool = {
  cursor: () => 'crosshair',
  down(p) {
    const d = S().doc
    if (!d) return
    const o = S().opts.wand
    const x = Math.floor(p.x), y = Math.floor(p.y)
    if (x < 0 || y < 0 || x >= d.width || y >= d.height) return
    const bytes = floodMask(sampleSource(d, o.sampleAll), x, y, o.tolerance, o.contiguous)
    const mode = d.selection ? selMode(p, o.mode) : 'new'
    setSelection(maskFromBytes(d.width, d.height, bytes, true), mode, 'Magic wand')
  },
}

// --- Bucket ---------------------------------------------------------------------

const bucket: Tool = {
  cursor: () => 'crosshair',
  down(p) {
    const d = S().doc
    if (!d) return
    const l = paintTarget()
    if (!l) return
    const doc = S().doc!
    const o = S().opts.bucket
    const x = Math.floor(p.x), y = Math.floor(p.y)
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return
    let srcImg: ImageData
    if (l.isMask) {
      const mc = makeCanvas(doc.width, doc.height)
      ctx2d(mc).drawImage(l.bmp.canvas, l.x, l.y)
      srcImg = ctx2d(mc, true).getImageData(0, 0, doc.width, doc.height)
    } else srcImg = sampleSource(doc, o.sampleAll)
    const bytes = floodMask(srcImg, x, y, o.tolerance, o.contiguous)
    const mask = maskFromBytes(doc.width, doc.height, bytes, true)
    const fill = makeCanvas(doc.width, doc.height)
    const fg = ctx2d(fill)
    fg.fillStyle = l.isMask ? grayOf(S().fg) : S().fg
    fg.fillRect(0, 0, doc.width, doc.height)
    fg.globalCompositeOperation = 'destination-in'
    fg.drawImage(mask.canvas, 0, 0)
    if (doc.selection) fg.drawImage(doc.selection.canvas, 0, 0)
    const b = maskBounds(mask)
    if (!b) return
    const patch = editPixels(l.bmp, { x: b.x - l.x, y: b.y - l.y, w: b.w, h: b.h }, g => g.drawImage(fill, -l.x, -l.y))
    commitPatches('Fill', [patch])
  },
}

// --- Gradient ---------------------------------------------------------------------

let grad: { layer: PaintTarget; a: Pt; b: Pt; work: HTMLCanvasElement } | null = null

function gradientCanvas(d: Doc, a: Pt, b: Pt, gray = false): HTMLCanvasElement {
  const o = S().opts.gradient
  const c = makeCanvas(d.width, d.height)
  const g = ctx2d(c)
  const f0 = gray ? grayOf(S().fg) : S().fg
  const fg = f0, bg = o.toTransparent ? f0 + '00' : gray ? grayOf(S().bg) : S().bg
  const gr = o.type === 'linear'
    ? g.createLinearGradient(a.x, a.y, b.x, b.y)
    : g.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)))
  gr.addColorStop(0, fg)
  gr.addColorStop(1, bg)
  g.fillStyle = gr
  g.fillRect(0, 0, d.width, d.height)
  if (d.selection) {
    g.globalCompositeOperation = 'destination-in'
    g.drawImage(d.selection.canvas, 0, 0)
  }
  return c
}

const gradient: Tool = {
  cursor: () => 'crosshair',
  down(p) {
    const l = paintTarget()
    if (!l) return
    grad = { layer: l, a: { x: p.x, y: p.y }, b: { x: p.x, y: p.y }, work: makeCanvas(l.bmp.canvas.width, l.bmp.canvas.height) }
  },
  move(p) {
    if (!grad) return
    let { x, y } = p
    if (p.shift) {
      // Snap to 45° steps.
      const dx = x - grad.a.x, dy = y - grad.a.y
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
      const len = Math.hypot(dx, dy)
      x = grad.a.x + Math.cos(ang) * len
      y = grad.a.y + Math.sin(ang) * len
    }
    grad.b = { x, y }
    const d = S().doc!
    const g = ctx2d(grad.work)
    g.globalCompositeOperation = 'copy'
    g.drawImage(grad.layer.bmp.canvas, 0, 0)
    g.globalCompositeOperation = 'source-over'
    g.drawImage(gradientCanvas(d, grad.a, grad.b, grad.layer.isMask), -grad.layer.x, -grad.layer.y)
    const t = grad.layer
    set({ preview: t.isMask ? { layerId: t.layer.id, mask: grad.work, maskX: t.x, maskY: t.y } : { layerId: t.layer.id, canvas: grad.work, x: t.x, y: t.y } })
    redrawOverlay()
  },
  up() {
    const gr = grad
    grad = null
    set({ preview: null })
    redrawOverlay()
    if (!gr || Math.hypot(gr.b.x - gr.a.x, gr.b.y - gr.a.y) < 1) return
    const d = S().doc!
    const c = gradientCanvas(d, gr.a, gr.b, gr.layer.isMask)
    const sel = d.selection && maskBounds(d.selection)
    const rect = sel ? { x: sel.x - gr.layer.x, y: sel.y - gr.layer.y, w: sel.w, h: sel.h } : { x: -gr.layer.x, y: -gr.layer.y, w: d.width, h: d.height }
    const patch = editPixels(gr.layer.bmp, rect, g => g.drawImage(c, -gr.layer.x, -gr.layer.y))
    commitPatches('Gradient', [patch])
  },
  overlay(g, dpr) {
    if (!grad) return
    const a = toScreen(grad.a.x, grad.a.y), b = toScreen(grad.b.x, grad.b.y)
    g.beginPath()
    g.moveTo(a.x * dpr, a.y * dpr)
    g.lineTo(b.x * dpr, b.y * dpr)
    g.lineWidth = 3 * dpr
    g.strokeStyle = 'rgba(0,0,0,.5)'
    g.stroke()
    g.lineWidth = 1.5 * dpr
    g.strokeStyle = '#fff'
    g.stroke()
    for (const [q, c] of [[a, S().fg], [b, S().opts.gradient.toTransparent ? 'transparent' : S().bg]] as const) {
      g.beginPath()
      g.arc(q.x * dpr, q.y * dpr, 5 * dpr, 0, Math.PI * 2)
      g.fillStyle = c
      g.fill()
      g.lineWidth = 1.5 * dpr
      g.strokeStyle = '#fff'
      g.stroke()
    }
  },
}

// --- Eyedropper ---------------------------------------------------------------------

function samplePixel(p: PInfo) {
  const s = S()
  if (!s.doc) return
  const x = Math.floor(p.x), y = Math.floor(p.y)
  if (x < 0 || y < 0 || x >= s.doc.width || y >= s.doc.height) return
  const c = compositeDoc(s.doc, s.ver, s.preview)
  const [r, g, b, a] = ctx2d(c, true).getImageData(x, y, 1, 1).data
  if (a === 0) return
  const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
  set(p.alt ? { bg: hex } : { fg: hex })
}

const eyedropper: Tool = {
  cursor: () => 'crosshair',
  down: samplePixel,
  move: samplePixel,
}

// --- Move -----------------------------------------------------------------------------

let mv: {
  start: Pt
  orig: Layer
  base: Doc
  float?: { rest: HTMLCanvasElement; piece: HTMLCanvasElement; layer: RasterLayer }
  dx: number
  dy: number
} | null = null

let snapLines: { h: number[]; v: number[] } | null = null

/** Snaps a moving box's edges/center to the canvas edges/center and guides. */
function snapDelta(b: Rect, dx: number, dy: number, d: Doc): { dx: number; dy: number } {
  const tol = 6 / S().view.zoom
  const xs = [0, d.width / 2, d.width, ...d.guides.v]
  const ys = [0, d.height / 2, d.height, ...d.guides.h]
  const pick = (edges: number[], targets: number[]) => {
    let best: { delta: number; at: number } | null = null
    for (const e of edges) for (const t of targets) {
      const delta = t - e
      if (Math.abs(delta) <= tol && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, at: t }
    }
    return best
  }
  const sx = pick([b.x + dx, b.x + dx + b.w / 2, b.x + dx + b.w], xs)
  const sy = pick([b.y + dy, b.y + dy + b.h / 2, b.y + dy + b.h], ys)
  snapLines = { v: sx ? [sx.at] : [], h: sy ? [sy.at] : [] }
  return { dx: Math.round(dx + (sx?.delta ?? 0)), dy: Math.round(dy + (sy?.delta ?? 0)) }
}

function nudge(dx: number, dy: number) {
  const d = S().doc
  const l = activeLayer()
  if (!d || !l || l.locked || l.kind === 'adjust') return
  if (d.selection && l.kind === 'raster') {
    const f = liftSelection(l, d)
    dropFloat(l, d, f, dx, dy)
    return
  }
  setDocSilent(replaceLayer(d, shiftLayer(l, dx, dy)))
  commit('Nudge')
}

function liftSelection(l: RasterLayer, d: Doc) {
  const { width: w, height: h } = l.bmp.canvas
  const piece = makeCanvas(w, h)
  const pg = ctx2d(piece)
  pg.drawImage(l.bmp.canvas, 0, 0)
  pg.globalCompositeOperation = 'destination-in'
  pg.drawImage(d.selection!.canvas, -l.x, -l.y)
  const rest = makeCanvas(w, h)
  const rg = ctx2d(rest)
  rg.drawImage(l.bmp.canvas, 0, 0)
  rg.globalCompositeOperation = 'destination-out'
  rg.drawImage(d.selection!.canvas, -l.x, -l.y)
  return { rest, piece, layer: l }
}

function dropFloat(l: RasterLayer, d: Doc, f: { rest: HTMLCanvasElement; piece: HTMLCanvasElement }, dx: number, dy: number) {
  const sb = maskBounds(d.selection!)!
  const r0 = { x: sb.x - l.x, y: sb.y - l.y, w: sb.w, h: sb.h }
  const r1 = { x: r0.x + dx, y: r0.y + dy, w: sb.w, h: sb.h }
  const x = Math.min(r0.x, r1.x), y = Math.min(r0.y, r1.y)
  const rect = { x, y, w: Math.max(r0.x + r0.w, r1.x + r1.w) - x, h: Math.max(r0.y + r0.h, r1.y + r1.h) - y }
  const patch = editPixels(l.bmp, rect, g => {
    g.clearRect(rect.x, rect.y, rect.w, rect.h)
    g.save()
    g.beginPath()
    g.rect(rect.x, rect.y, rect.w, rect.h)
    g.clip()
    g.drawImage(f.rest, 0, 0)
    g.drawImage(f.piece, dx, dy)
    g.restore()
  })
  const sel = makeCanvas(d.width, d.height)
  ctx2d(sel).drawImage(d.selection!.canvas, dx, dy)
  setDocSilent({ ...S().doc!, selection: { id: `sel_${Date.now()}`, canvas: sel } })
  commitPatches('Move selection', [patch])
}

const move: Tool = {
  cursor: () => 'default',
  down(p) {
    let d = S().doc
    if (!d) return
    if (S().opts.move.autoSelect !== p.ctrl && !d.selection) {
      const hit = hitLayer(d, p.x, p.y)
      if (hit && hit.id !== d.activeId) {
        selectLayer(hit.id)
        d = S().doc!
      }
    }
    let l = activeLayer()
    if (!l || l.kind === 'adjust') return
    if (l.locked) return toast('Layer is locked')
    if (d.selection && l.kind === 'raster') {
      const r = editableRaster()
      if (!r) return
      l = r
      d = S().doc!
      mv = { start: { x: p.x, y: p.y }, orig: l, base: d, float: liftSelection(r, d), dx: 0, dy: 0 }
      return
    }
    mv = { start: { x: p.x, y: p.y }, orig: l, base: d, dx: 0, dy: 0 }
  },
  move(p) {
    if (!mv) return
    let dx = Math.round(p.x - mv.start.x), dy = Math.round(p.y - mv.start.y)
    if (p.shift) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0)
    mv.dx = dx
    mv.dy = dy
    if (mv.float) {
      const f = mv.float
      set({ preview: { layerId: f.layer.id, canvas: f.rest, x: f.layer.x, y: f.layer.y, extra: { src: f.piece, x: f.layer.x + dx, y: f.layer.y + dy } } })
      redrawOverlay()
      return
    }
    if (S().opts.move.snap && !p.ctrl) {
      const sn = snapDelta(layerBounds(mv.orig, mv.base), dx, dy, mv.base)
      dx = sn.dx
      dy = sn.dy
      mv.dx = dx
      mv.dy = dy
    }
    setDocSilent(replaceLayer(mv.base, shiftLayer(mv.orig, dx, dy)))
    redrawOverlay()
  },
  up() {
    const m = mv
    mv = null
    snapLines = null
    if (!m) return
    set({ preview: null })
    if (!m.dx && !m.dy) {
      redrawOverlay()
      return
    }
    if (m.float) dropFloat(m.float.layer, m.base, m.float, m.dx, m.dy)
    else commit('Move')
  },
  key(e) {
    const step = e.shiftKey ? 10 : 1
    const map: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const v = map[e.key]
    if (!v) return false
    nudge(v[0], v[1])
    return true
  },
  overlay(g, dpr) {
    const d = S().doc
    const l = activeLayer()
    if (snapLines && mv) {
      g.strokeStyle = '#ffffff'
      g.lineWidth = dpr
      g.beginPath()
      for (const x of snapLines.v) { const s = toScreen(x, 0); g.moveTo(Math.round(s.x * dpr) + 0.5, 0); g.lineTo(Math.round(s.x * dpr) + 0.5, g.canvas.height) }
      for (const y of snapLines.h) { const s = toScreen(0, y); g.moveTo(0, Math.round(s.y * dpr) + 0.5); g.lineTo(g.canvas.width, Math.round(s.y * dpr) + 0.5) }
      g.stroke()
    }
    if (!d || !l || l.kind === 'adjust' || d.selection) return
    let b = layerBounds(l, d)
    if (l.kind === 'raster') {
      if (mv) return
      return
    }
    if (l.kind === 'shape') b = shapeBox(l)
    if (l.kind === 'text') b = textLayout(l).box
    const a = toScreen(b.x, b.y), c = toScreen(b.x + b.w, b.y + b.h)
    g.strokeStyle = ACCENT
    g.lineWidth = dpr
    g.strokeRect(Math.round(a.x * dpr) + 0.5, Math.round(a.y * dpr) + 0.5, Math.round((c.x - a.x) * dpr), Math.round((c.y - a.y) * dpr))
  },
}

// --- Crop -------------------------------------------------------------------------------

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move' | 'new'
let cropRect: Rect | null = null
let cropDrag: { h: Handle; start: Pt; orig: Rect } | null = null

export function cropAspect(): number | null {
  const a = S().opts.crop.aspect
  const d = S().doc
  if (a === 'free') return null
  if (a === 'original') return d ? d.width / d.height : null
  const [w, h] = a.split(':').map(Number)
  return w / h
}

export function resetCrop() {
  const d = S().doc
  cropRect = d ? fitAspect({ x: 0, y: 0, w: d.width, h: d.height }) : null
  redrawOverlay()
}

function fitAspect(r: Rect): Rect {
  const a = cropAspect()
  if (!a) return r
  let w = r.w, h = r.w / a
  if (h > r.h) { h = r.h; w = h * a }
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h }
}

export function applyCrop() {
  if (!cropRect || !S().doc) return
  const r = cropRect
  crop({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }, S().opts.crop.deleteCropped)
  resetCrop()
  import('../core/view').then(v => v.fitView())
}

export function cropSize() {
  return cropRect ? { w: Math.round(cropRect.w), h: Math.round(cropRect.h) } : null
}

function cropHandleAt(sx: number, sy: number): Handle {
  if (!cropRect) return 'new'
  const a = toScreen(cropRect.x, cropRect.y), b = toScreen(cropRect.x + cropRect.w, cropRect.y + cropRect.h)
  const near = (v: number, t: number) => Math.abs(v - t) < 9
  const inX = sx > a.x - 9 && sx < b.x + 9, inY = sy > a.y - 9 && sy < b.y + 9
  const W = near(sx, a.x), E = near(sx, b.x), N = near(sy, a.y), S_ = near(sy, b.y)
  if (N && W) return 'nw'
  if (N && E) return 'ne'
  if (S_ && W) return 'sw'
  if (S_ && E) return 'se'
  if (N && inX) return 'n'
  if (S_ && inX) return 's'
  if (W && inY) return 'w'
  if (E && inY) return 'e'
  if (sx > a.x && sx < b.x && sy > a.y && sy < b.y) return 'move'
  return 'new'
}

const CURSORS: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move', new: 'crosshair' }

const cropTool: Tool = {
  cursor: p => (p ? CURSORS[cropHandleAt(p.sx, p.sy)] : 'crosshair'),
  activate: resetCrop,
  down(p) {
    if (!cropRect) resetCrop()
    const h = cropHandleAt(p.sx, p.sy)
    cropDrag = { h, start: { x: p.x, y: p.y }, orig: { ...cropRect! } }
    if (h === 'new') cropRect = { x: p.x, y: p.y, w: 0, h: 0 }
  },
  move(p) {
    if (!cropDrag) return
    const { h, start, orig } = cropDrag
    const dx = p.x - start.x, dy = p.y - start.y
    const a = cropAspect() ?? (p.shift ? orig.w / Math.max(1, orig.h) : null)
    let r = { ...orig }
    if (h === 'move') r = { ...orig, x: orig.x + dx, y: orig.y + dy }
    else if (h === 'new') {
      let w = p.x - start.x, hh = p.y - start.y
      if (a) hh = (Math.sign(hh || 1) * Math.abs(w)) / a
      r = { x: Math.min(start.x, start.x + w), y: Math.min(start.y, start.y + hh), w: Math.abs(w), h: Math.abs(hh) }
    } else {
      let x0 = orig.x, y0 = orig.y, x1 = orig.x + orig.w, y1 = orig.y + orig.h
      if (h.includes('w')) x0 += dx
      if (h.includes('e')) x1 += dx
      if (h.includes('n')) y0 += dy
      if (h.includes('s')) y1 += dy
      if (x1 < x0) [x0, x1] = [x1, x0]
      if (y1 < y0) [y0, y1] = [y1, y0]
      r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
      if (a) {
        if (h === 'n' || h === 's') {
          const w = r.h * a
          r.x = orig.x + (orig.w - w) / 2
          r.w = w
        } else if (h === 'e' || h === 'w') {
          const hh = r.w / a
          r.y = orig.y + (orig.h - hh) / 2
          r.h = hh
        } else {
          const hh = r.w / a
          if (h.includes('n')) r.y = y1 - hh
          r.h = hh
        }
      }
    }
    cropRect = r
    redrawOverlay()
  },
  up() {
    cropDrag = null
    if (cropRect && (cropRect.w < 2 || cropRect.h < 2)) resetCrop()
  },
  key(e) {
    if (e.key === 'Enter') { applyCrop(); return true }
    if (e.key === 'Escape') { resetCrop(); return true }
    return false
  },
  overlay(g, dpr) {
    const d = S().doc
    if (!d) return
    if (!cropRect) resetCrop()
    const r = cropRect!
    const a = toScreen(r.x, r.y), b = toScreen(r.x + r.w, r.y + r.h)
    const x0 = a.x * dpr, y0 = a.y * dpr, x1 = b.x * dpr, y1 = b.y * dpr
    g.fillStyle = 'rgba(0,0,0,.55)'
    g.beginPath()
    g.rect(0, 0, g.canvas.width, g.canvas.height)
    g.rect(x0, y0, x1 - x0, y1 - y0)
    g.fill('evenodd')
    g.strokeStyle = 'rgba(255,255,255,.35)'
    g.lineWidth = dpr
    g.beginPath()
    for (let i = 1; i < 3; i++) {
      const x = x0 + ((x1 - x0) * i) / 3, y = y0 + ((y1 - y0) * i) / 3
      g.moveTo(x, y0); g.lineTo(x, y1)
      g.moveTo(x0, y); g.lineTo(x1, y)
    }
    g.stroke()
    g.strokeStyle = '#fff'
    g.lineWidth = 1.5 * dpr
    g.strokeRect(x0, y0, x1 - x0, y1 - y0)
    g.fillStyle = ACCENT
    const hs = 8 * dpr
    for (const [hx, hy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1], [(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1], [x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]]) {
      g.fillRect(hx - hs / 2, hy - hs / 2, hs, hs)
    }
    if (cropDrag) drawSizeTag(g, dpr, r)
  },
}

// --- Text ------------------------------------------------------------------------------

export let textSession: { id: string; base: Doc; created: boolean } | null = null

export function beginTextEdit(l: TextLayer, base: Doc, created: boolean) {
  textSession = { id: l.id, base, created }
  set({ textEditId: l.id, preview: null })
}

export function endTextEdit() {
  const t = textSession
  textSession = null
  set({ textEditId: null })
  if (!t) return
  const d = S().doc
  const l = d?.layers.find(x => x.id === t.id) as TextLayer | undefined
  if (!d || !l) return
  if (!l.text.trim()) {
    if (t.created) setDocSilent(t.base)
    else commit('Delete text')
    return
  }
  const before = t.base.layers.find(x => x.id === t.id) as TextLayer | undefined
  if (t.created) commit('Text')
  else if (before && before.text !== l.text) commit('Edit text')
}

const text: Tool = {
  cursor: () => 'text',
  down(p) {
    if (textSession) {
      endTextEdit()
      return
    }
    const d = S().doc
    if (!d) return
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const l = d.layers[i]
      if (l.kind !== 'text' || !l.visible) continue
      const b = textLayout(l).box
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        if (l.locked) return toast('Layer is locked')
        setDocSilent({ ...d, activeId: l.id })
        beginTextEdit(l, d, false)
        return
      }
    }
    const o = S().opts.text
    const id = `layer_t${Date.now().toString(36)}`
    const l: TextLayer = {
      id, name: 'Text', visible: true, locked: false, opacity: 1, blend: 'source-over', kind: 'text',
      x: Math.round(p.x), y: Math.round(p.y - (o.size * 1.2) / 2), text: '', font: o.font, size: o.size, weight: o.weight,
      italic: false, color: S().fg, align: o.align, lineHeight: 1.2,
    }
    const i = d.layers.findIndex(x => x.id === d.activeId)
    const layers = [...d.layers]
    layers.splice(i + 1, 0, l)
    setDocSilent({ ...d, layers, activeId: id })
    beginTextEdit(l, d, true)
  },
  deactivate() {
    if (textSession) endTextEdit()
  },
}

// --- Shapes --------------------------------------------------------------------------------

let shp: { base: Doc; start: Pt; layer: ShapeLayer } | null = null

const shape: Tool = {
  cursor: () => 'crosshair',
  down(p) {
    const d = S().doc
    if (!d) return
    const l = newShape(S().opts.shape.shape, Math.round(p.x), Math.round(p.y))
    shp = { base: d, start: { x: p.x, y: p.y }, layer: l }
    addShapeSilent(l)
  },
  move(p) {
    if (!shp) return
    let w = p.x - shp.start.x, h = p.y - shp.start.y
    const isLine = shp.layer.shape === 'line'
    if (p.shift) {
      if (isLine) {
        const ang = Math.round(Math.atan2(h, w) / (Math.PI / 4)) * (Math.PI / 4)
        const len = Math.hypot(w, h)
        w = Math.cos(ang) * len
        h = Math.sin(ang) * len
      } else {
        const m = Math.max(Math.abs(w), Math.abs(h))
        w = Math.sign(w || 1) * m
        h = Math.sign(h || 1) * m
      }
    }
    let x = shp.start.x, y = shp.start.y
    if (p.alt) {
      x -= w
      y -= h
      w *= 2
      h *= 2
    }
    const l: ShapeLayer = isLine
      ? { ...shp.layer, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
      : { ...shp.layer, x: Math.round(Math.min(x, x + w)), y: Math.round(Math.min(y, y + h)), w: Math.round(Math.abs(w)), h: Math.round(Math.abs(h)) }
    shp.layer = l
    setDocSilent(replaceLayer(S().doc!, l))
    redrawOverlay()
  },
  up() {
    const s = shp
    shp = null
    if (!s) return
    const l = s.layer
    if (Math.abs(l.w) < 2 && Math.abs(l.h) < 2) {
      setDocSilent(s.base)
      return
    }
    commit(l.name)
  },
  overlay(g, dpr) {
    if (shp) drawSizeTag(g, dpr, { x: 0, y: 0, w: Math.abs(shp.layer.w), h: Math.abs(shp.layer.h) })
  },
}

// --- Hand / zoom ----------------------------------------------------------------------------

let handLast: Pt | null = null
const hand: Tool = {
  cursor: () => (handLast ? 'grabbing' : 'grab'),
  down(p) { handLast = { x: p.sx, y: p.sy } },
  move(p) {
    if (!handLast) return
    panBy(p.sx - handLast.x, p.sy - handLast.y)
    handLast = { x: p.sx, y: p.sy }
  },
  up() { handLast = null },
}

const zoom: Tool = {
  cursor: p => (p?.alt ? 'zoom-out' : 'zoom-in'),
  down(p) { zoomStep(p.alt ? -1 : 1, p.sx, p.sy) },
}

// --- Free transform ------------------------------------------------------------------

type XHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move' | 'rotate'

interface Xf {
  layer: Layer
  prevTool: ToolId
  src: LayerSource
  box: Rect
  cx: number
  cy: number
  w: number
  h: number
  rot: number
  drag?: { handle: XHandle; q0: Pt; cx: number; cy: number; w: number; h: number; rot: number }
}

let xf: Xf | null = null
const UNIT: Record<string, [number, number]> = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] }

function xfMatrix(t: Xf): DOMMatrix {
  return new DOMMatrix()
    .translate(t.cx, t.cy)
    .rotate((t.rot * 180) / Math.PI)
    .scale(t.w / t.box.w, t.h / t.box.h)
    .translate(-(t.box.x + t.box.w / 2), -(t.box.y + t.box.h / 2))
}

function xfCorner(t: Xf, ux: number, uy: number): Pt {
  const lx = (ux * t.w) / 2, ly = (uy * t.h) / 2
  const c = Math.cos(t.rot), s = Math.sin(t.rot)
  return { x: t.cx + lx * c - ly * s, y: t.cy + lx * s + ly * c }
}

export function transformState() {
  return xf ? { sx: xf.w / xf.box.w, sy: xf.h / xf.box.h, rot: (xf.rot * 180) / Math.PI } : null
}

export function setTransformState(p: { sx?: number; sy?: number; rot?: number }) {
  if (!xf) return
  if (p.sx !== undefined) xf.w = xf.box.w * p.sx
  if (p.sy !== undefined) xf.h = xf.box.h * p.sy
  if (p.rot !== undefined) xf.rot = (p.rot * Math.PI) / 180
  xfPreview()
}

function xfPreview() {
  const t = xf
  const d = S().doc
  if (!t || !d) return
  const c = makeCanvas(d.width, d.height)
  const g = ctx2d(c)
  g.imageSmoothingQuality = 'high'
  g.setTransform(xfMatrix(t))
  g.drawImage(t.src.src, t.src.x, t.src.y)
  let mask: HTMLCanvasElement | undefined
  if (t.layer.mask) {
    mask = makeCanvas(d.width, d.height)
    const mg = ctx2d(mask)
    mg.fillStyle = '#000'
    mg.fillRect(0, 0, d.width, d.height)
    mg.setTransform(xfMatrix(t))
    mg.drawImage(t.layer.mask.bmp.canvas, t.layer.mask.x, t.layer.mask.y)
  }
  set({ preview: { layerId: t.layer.id, canvas: c, x: 0, y: 0, mask, maskX: 0, maskY: 0 } })
  redrawOverlay()
}

export function beginTransform() {
  const d = S().doc
  const l = activeLayer()
  if (!d || !l) return
  if (l.kind === 'adjust') return toast('Pick a pixel, text or shape layer')
  if (l.locked) return toast('Layer is locked')
  if (xf) return
  const src = layerSource(l)
  if (!src) return
  let box: Rect
  if (l.kind === 'raster') {
    const b = alphaBounds(l.bmp.canvas)
    if (!b) return toast('Layer is empty')
    box = { x: b.x + l.x, y: b.y + l.y, w: b.w, h: b.h }
  } else box = layerBounds(l, d)
  box = { ...box, w: Math.max(1, box.w), h: Math.max(1, box.h) }
  xf = { layer: l, prevTool: S().tool === 'transform' ? 'move' : S().tool, src, box, cx: box.x + box.w / 2, cy: box.y + box.h / 2, w: box.w, h: box.h, rot: 0 }
  set({ tool: 'transform' })
  xfPreview()
}

export function endTransform(apply: boolean) {
  const t = xf
  xf = null
  set({ preview: null })
  if (S().tool === 'transform') set({ tool: t?.prevTool ?? 'move' })
  redrawOverlay()
  if (!t || !apply) return
  const d = S().doc!
  const sx = t.w / t.box.w, sy = t.h / t.box.h
  const M = xfMatrix(t)
  const unchanged = Math.abs(sx - 1) < 1e-4 && Math.abs(sy - 1) < 1e-4 && Math.abs(t.rot) < 1e-4 && Math.abs(t.cx - (t.box.x + t.box.w / 2)) < 1e-3 && Math.abs(t.cy - (t.box.y + t.box.h / 2)) < 1e-3
  if (unchanged) return
  const noRot = Math.abs(t.rot) < 1e-4
  let nl: Layer | null = null
  const l = t.layer
  if (l.kind === 'shape' && (l.shape === 'line' || noRot)) {
    const a = M.transformPoint(new DOMPoint(l.x, l.y)), b = M.transformPoint(new DOMPoint(l.x + l.w, l.y + l.h))
    nl = l.shape === 'line'
      ? { ...l, x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }
      : { ...l, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), radius: l.radius * Math.min(Math.abs(sx), Math.abs(sy)) }
  } else if (l.kind === 'text' && noRot && Math.abs(sx - sy) < 0.01 && sx > 0) {
    const tl = M.transformPoint(new DOMPoint(t.box.x, t.box.y))
    const w = t.box.w * sx
    nl = { ...l, size: l.size * sx, x: l.align === 'left' ? tl.x : l.align === 'center' ? tl.x + w / 2 : tl.x + w, y: tl.y }
  } else {
    const r = rasterOf(l, d)
    const src = r === l ? t.src : { src: r.bmp.canvas, x: r.x, y: r.y }
    const pts = [[src.x, src.y], [src.x + src.src.width, src.y], [src.x, src.y + src.src.height], [src.x + src.src.width, src.y + src.src.height]].map(([x, y]) => M.transformPoint(new DOMPoint(x, y)))
    const bx = Math.floor(Math.min(...pts.map(p => p.x))), by = Math.floor(Math.min(...pts.map(p => p.y)))
    const bw = Math.ceil(Math.max(...pts.map(p => p.x))) - bx, bh = Math.ceil(Math.max(...pts.map(p => p.y))) - by
    const c = makeCanvas(Math.min(16384, bw), Math.min(16384, bh))
    const g = ctx2d(c)
    g.imageSmoothingQuality = 'high'
    g.setTransform(new DOMMatrix().translate(-bx, -by).multiply(M))
    g.drawImage(src.src, src.x, src.y)
    nl = { ...r, bmp: { id: `bmp_xf${Date.now().toString(36)}`, canvas: c }, x: bx, y: by }
    if (l.kind === 'text' || l.kind === 'shape') toast(`${l.kind === 'text' ? 'Text' : 'Shape'} was rasterized to rotate it`)
  }
  if (l.mask && nl) {
    const m = makeCanvas(d.width, d.height)
    const mg = ctx2d(m)
    mg.fillStyle = '#000'
    mg.fillRect(0, 0, d.width, d.height)
    mg.setTransform(M)
    mg.drawImage(l.mask.bmp.canvas, l.mask.x, l.mask.y)
    nl = { ...nl, mask: { ...l.mask, bmp: { id: `bmp_m${Date.now().toString(36)}`, canvas: m }, x: 0, y: 0 } } as Layer
  }
  setDocSilent(replaceLayer(S().doc!, nl!))
  commit('Free transform')
}

function xfHandleAt(sx: number, sy: number): XHandle {
  if (!xf) return 'move'
  for (const [h, [ux, uy]] of Object.entries(UNIT)) {
    const p = xfCorner(xf, ux, uy)
    const s = toScreen(p.x, p.y)
    if (Math.abs(s.x - sx) < 8 && Math.abs(s.y - sy) < 8) return h as XHandle
  }
  // Inside the (rotated) box?
  const d = toDoc(sx, sy)
  const c = Math.cos(-xf.rot), s = Math.sin(-xf.rot)
  const lx = (d.x - xf.cx) * c - (d.y - xf.cy) * s, ly = (d.x - xf.cx) * s + (d.y - xf.cy) * c
  return Math.abs(lx) <= Math.abs(xf.w) / 2 && Math.abs(ly) <= Math.abs(xf.h) / 2 ? 'move' : 'rotate'
}

const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5 12a7 7 0 1 0 2.1-5" fill="none" stroke="#000" stroke-width="4" stroke-linecap="round"/><path d="M5 12a7 7 0 1 0 2.1-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M4 3v5h5" fill="none" stroke="#000" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 3v5h5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>')}") 12 12, crosshair`
const XCURSORS: Record<XHandle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move', rotate: ROTATE_CURSOR }

const transform: Tool = {
  cursor: p => (p ? XCURSORS[xfHandleAt(p.sx, p.sy)] : 'default'),
  activate() {
    if (!xf) beginTransform()
  },
  deactivate() {
    if (xf) endTransform(true)
  },
  down(p) {
    if (!xf) return
    if (p.dbl && xfHandleAt(p.sx, p.sy) === 'move') return endTransform(true)
    xf.drag = { handle: xfHandleAt(p.sx, p.sy), q0: { x: p.x, y: p.y }, cx: xf.cx, cy: xf.cy, w: xf.w, h: xf.h, rot: xf.rot }
  },
  move(p) {
    const t = xf
    const dr = t?.drag
    if (!t || !dr) return
    if (dr.handle === 'move') {
      t.cx = dr.cx + p.x - dr.q0.x
      t.cy = dr.cy + p.y - dr.q0.y
    } else if (dr.handle === 'rotate') {
      let r = dr.rot + Math.atan2(p.y - dr.cy, p.x - dr.cx) - Math.atan2(dr.q0.y - dr.cy, dr.q0.x - dr.cx)
      if (p.shift) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12)
      t.rot = r
    } else {
      const [ux, uy] = UNIT[dr.handle]
      const start = { ...t, cx: dr.cx, cy: dr.cy, w: dr.w, h: dr.h, rot: dr.rot }
      const opp = xfCorner(start, -ux, -uy)
      const c = Math.cos(-dr.rot), s = Math.sin(-dr.rot)
      const dx = (p.x - opp.x) * c - (p.y - opp.y) * s, dy = (p.x - opp.x) * s + (p.y - opp.y) * c
      let w = ux ? dx / ux : dr.w, h = uy ? dy / uy : dr.h
      // Corners keep proportions unless Shift is held (shapes: the other way round).
      const keep = ux && uy && (p.shift === (t.layer.kind === 'shape'))
      if (keep) {
        const kx = w / dr.w, ky = h / dr.h
        const k = Math.abs(kx) > Math.abs(ky) ? Math.abs(kx) : Math.abs(ky)
        w = dr.w * k * Math.sign(kx || 1)
        h = dr.h * k * Math.sign(ky || 1)
      }
      if (Math.abs(w) < 1) w = Math.sign(w || 1)
      if (Math.abs(h) < 1) h = Math.sign(h || 1)
      const cr = Math.cos(dr.rot), sr = Math.sin(dr.rot)
      const lx = (ux * w) / 2, ly = (uy * h) / 2
      if (ux && uy) { t.cx = opp.x + lx * cr - ly * sr; t.cy = opp.y + lx * sr + ly * cr }
      else if (ux) { const o = xfCorner(start, -ux, 0); t.cx = o.x + lx * cr; t.cy = o.y + lx * sr }
      else { const o = xfCorner(start, 0, -uy); t.cx = o.x - ly * sr; t.cy = o.y + ly * cr }
      t.w = w
      t.h = h
    }
    xfPreview()
  },
  up() {
    if (xf) xf.drag = undefined
  },
  key(e) {
    if (!xf) return false
    if (e.key === 'Enter') { endTransform(true); return true }
    if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) { endTransform(false); return true }
    return false
  },
  overlay(g, dpr) {
    if (!xf) return
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([ux, uy]) => toScreen(xfCorner(xf!, ux, uy).x, xfCorner(xf!, ux, uy).y))
    g.beginPath()
    pts.forEach((p, i) => (i ? g.lineTo(p.x * dpr, p.y * dpr) : g.moveTo(p.x * dpr, p.y * dpr)))
    g.closePath()
    g.lineWidth = 1.5 * dpr
    g.strokeStyle = 'rgba(0,0,0,.5)'
    g.stroke()
    g.lineWidth = dpr
    g.strokeStyle = ACCENT
    g.stroke()
    const hs = 8 * dpr
    for (const [ux, uy] of Object.values(UNIT)) {
      const p = toScreen(xfCorner(xf, ux, uy).x, xfCorner(xf, ux, uy).y)
      g.fillStyle = '#0b0b0c'
      g.fillRect(p.x * dpr - hs / 2, p.y * dpr - hs / 2, hs, hs)
      g.strokeStyle = ACCENT
      g.strokeRect(p.x * dpr - hs / 2, p.y * dpr - hs / 2, hs, hs)
    }
    const c = toScreen(xf.cx, xf.cy)
    g.beginPath()
    g.arc(c.x * dpr, c.y * dpr, 3 * dpr, 0, Math.PI * 2)
    g.strokeStyle = ACCENT
    g.stroke()
  },
}

// --- Registry --------------------------------------------------------------------------------

export const TOOLS: Record<ToolId, Tool> = {
  move, marquee, lasso, wand, crop: cropTool, eyedropper,
  brush: paintTool('brush'), eraser: paintTool('eraser'), clone: paintTool('clone'), dodge: paintTool('dodge'), focus: paintTool('focus'), bucket, gradient, text, shape, hand, zoom, transform,
}

export function setHover(p: PInfo | null) {
  hover = p
}

export function getHover() {
  return hover
}

export function isToolBusy() {
  return !!(stroke || marq || mv || grad || shp || cropDrag || handLast || (lassoPts && !polyActive) || xf?.drag)
}
