import { applyAdjustment } from './adjustments'
import { ctx2d, makeCanvas } from './bitmap'
import { S } from './store'
import type { AdjustLayer, Doc, Layer, Rect, ShapeLayer, TextLayer } from './types'

export interface LayerSource {
  src: HTMLCanvasElement
  x: number
  y: number
}

/** Live replacement for one layer while a tool is working on it. */
export interface Preview {
  layerId: string
  /** Replacement pixels for the layer. */
  canvas?: HTMLCanvasElement
  x?: number
  y?: number
  /** Drawn on top of the replacement (floating selection). */
  extra?: LayerSource
  /** Replacement mask canvas (grayscale). */
  mask?: HTMLCanvasElement
  maskX?: number
  maskY?: number
  hidden?: boolean
}

let fontGen = 0
export function invalidateFonts() {
  fontGen++
}

const vectorCache = new WeakMap<Layer, { gen: number; s: LayerSource }>()

export function fontString(l: Pick<TextLayer, 'italic' | 'weight' | 'size' | 'font'>, scale = 1) {
  return `${l.italic ? 'italic ' : ''}${l.weight} ${l.size * scale}px "${l.font}", "Geist Variable", sans-serif`
}

let measureCtx: CanvasRenderingContext2D | null = null
function measurer() {
  if (!measureCtx) measureCtx = ctx2d(makeCanvas(1, 1))
  return measureCtx
}

export function textLayout(l: TextLayer) {
  const g = measurer()
  g.font = fontString(l)
  const lines = l.text.split('\n')
  const widths = lines.map(s => g.measureText(s).width)
  const w = Math.max(1, ...widths)
  const lh = l.size * l.lineHeight
  const h = Math.max(lh, lines.length * lh)
  const left = l.align === 'left' ? l.x : l.align === 'center' ? l.x - w / 2 : l.x - w
  return { lines, widths, w, h, lh, box: { x: left, y: l.y, w, h } as Rect }
}

export function shapeBox(l: ShapeLayer): Rect {
  const x = Math.min(l.x, l.x + l.w), y = Math.min(l.y, l.y + l.h)
  return { x, y, w: Math.abs(l.w), h: Math.abs(l.h) }
}

export function traceShape(g: CanvasRenderingContext2D | Path2D, l: ShapeLayer, ox = 0, oy = 0) {
  const b = shapeBox(l)
  const x = b.x - ox, y = b.y - oy
  if (l.shape === 'line') {
    g.moveTo(l.x - ox, l.y - oy)
    g.lineTo(l.x + l.w - ox, l.y + l.h - oy)
  } else if (l.shape === 'ellipse') {
    g.ellipse(x + b.w / 2, y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2)
  } else if (l.radius > 0) {
    g.roundRect(x, y, b.w, b.h, Math.min(l.radius, b.w / 2, b.h / 2))
  } else {
    g.rect(x, y, b.w, b.h)
  }
}

function renderShape(l: ShapeLayer): LayerSource {
  const b = shapeBox(l)
  const pad = Math.ceil((l.stroke ? l.strokeWidth : 0) / 2) + 2
  const c = makeCanvas(b.w + pad * 2, b.h + pad * 2)
  const g = ctx2d(c)
  const ox = b.x - pad, oy = b.y - pad
  g.beginPath()
  traceShape(g, l, ox, oy)
  if (l.fill && l.shape !== 'line') {
    g.fillStyle = l.fill
    g.fill()
  }
  if (l.stroke && l.strokeWidth > 0) {
    g.strokeStyle = l.stroke
    g.lineWidth = l.strokeWidth
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.stroke()
  }
  return { src: c, x: ox, y: oy }
}

function renderText(l: TextLayer): LayerSource {
  const t = textLayout(l)
  const pad = Math.ceil(l.size * 0.5)
  const c = makeCanvas(t.w + pad * 2, t.h + pad * 2)
  const g = ctx2d(c)
  g.font = fontString(l)
  g.fillStyle = l.color
  g.textBaseline = 'middle'
  g.textAlign = l.align
  const ax = l.align === 'left' ? pad : l.align === 'center' ? pad + t.w / 2 : pad + t.w
  t.lines.forEach((s, i) => g.fillText(s, ax, pad + i * t.lh + t.lh / 2))
  return { src: c, x: t.box.x - pad, y: t.box.y - pad }
}

export function layerSource(l: Layer): LayerSource | null {
  if (l.kind === 'raster') return { src: l.bmp.canvas, x: l.x, y: l.y }
  if (l.kind === 'adjust') return null
  const hit = vectorCache.get(l)
  if (hit && hit.gen === fontGen) return hit.s
  const s = l.kind === 'text' ? renderText(l) : renderShape(l)
  vectorCache.set(l, { gen: fontGen, s })
  return s
}

// --- Masks ------------------------------------------------------------------

const alphaCache = new WeakMap<HTMLCanvasElement, { ver: number; c: HTMLCanvasElement }>()

/** Converts a grayscale mask into an alpha mask (white, alpha = gray). */
export function maskToAlpha(gray: HTMLCanvasElement, cacheable = true): HTMLCanvasElement {
  const ver = S().ver
  const hit = cacheable ? alphaCache.get(gray) : undefined
  if (hit && hit.ver === ver) return hit.c
  const { width: w, height: h } = gray
  const img = ctx2d(gray, true).getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    d[i + 3] = d[i]
    d[i] = d[i + 1] = d[i + 2] = 255
  }
  const c = hit && hit.c.width === w && hit.c.height === h ? hit.c : makeCanvas(w, h)
  ctx2d(c).putImageData(img, 0, 0)
  if (cacheable) alphaCache.set(gray, { ver, c })
  return c
}

function activeMask(l: Layer, preview?: Preview | null): { canvas: HTMLCanvasElement; x: number; y: number; live: boolean } | null {
  if (!l.mask || !l.mask.enabled) return null
  if (preview && preview.layerId === l.id && preview.mask) {
    return { canvas: preview.mask, x: preview.maskX ?? l.mask.x, y: preview.maskY ?? l.mask.y, live: true }
  }
  return { canvas: l.mask.bmp.canvas, x: l.mask.x, y: l.mask.y, live: false }
}

// --- Effects ----------------------------------------------------------------

function silhouette(src: HTMLCanvasElement, color: string) {
  const c = makeCanvas(src.width, src.height)
  const g = ctx2d(c)
  g.drawImage(src, 0, 0)
  g.globalCompositeOperation = 'source-in'
  g.fillStyle = color
  g.fillRect(0, 0, c.width, c.height)
  return c
}

export function hasFx(l: Layer) {
  const f = l.fx
  return !!f && !!(f.shadow?.on || f.glow?.on || f.stroke?.on)
}

function applyFx(s: LayerSource, l: Layer): LayerSource {
  const f = l.fx!
  const sh = f.shadow?.on ? f.shadow : null
  const gl = f.glow?.on ? f.glow : null
  const st = f.stroke?.on ? f.stroke : null
  const pad = Math.ceil(Math.max(sh ? sh.distance + sh.size * 1.5 : 0, gl ? gl.size * 1.5 : 0, st ? st.size : 0)) + 2
  const src = s.src
  const out = makeCanvas(src.width + pad * 2, src.height + pad * 2)
  const g = ctx2d(out)
  if (sh) {
    const a = (sh.angle * Math.PI) / 180
    g.save()
    g.globalAlpha = sh.opacity
    if (sh.size > 0) g.filter = `blur(${sh.size / 2}px)`
    g.drawImage(silhouette(src, sh.color), pad - Math.cos(a) * sh.distance, pad + Math.sin(a) * sh.distance)
    g.restore()
  }
  if (gl) {
    g.save()
    g.globalAlpha = gl.opacity
    g.filter = `blur(${Math.max(0.5, gl.size / 2)}px)`
    const sil = silhouette(src, gl.color)
    g.drawImage(sil, pad, pad)
    g.drawImage(sil, pad, pad)
    g.restore()
  }
  if (st && st.size > 0) {
    const sil = silhouette(src, st.color)
    const ring = makeCanvas(out.width, out.height)
    const rg = ctx2d(ring)
    // Dilate the silhouette by stamping it around circles of growing radius.
    for (let r = Math.min(1, st.size); r <= st.size; r += Math.max(1, st.size / 4)) {
      const n = Math.min(64, Math.max(8, Math.ceil((Math.PI * 2 * r) / 1.5)))
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2
        rg.drawImage(sil, pad + Math.cos(a) * r, pad + Math.sin(a) * r)
      }
    }
    g.globalAlpha = st.opacity
    g.drawImage(ring, 0, 0)
    g.globalAlpha = 1
  }
  g.drawImage(src, pad, pad)
  return { src: out, x: s.x - pad, y: s.y - pad }
}

// --- Layer rendering ----------------------------------------------------------

const renderCache = new WeakMap<Layer, { ver: number; fontGen: number; s: LayerSource | null }>()

/** Layer pixels with mask and effects applied, in doc space. */
export function renderedLayer(l: Layer, preview?: Preview | null): LayerSource | null {
  const live = !!preview && preview.layerId === l.id
  if (!live) {
    const hit = renderCache.get(l)
    if (hit && hit.ver === S().ver && hit.fontGen === fontGen) return hit.s
  }
  let s: LayerSource | null
  if (live && preview!.canvas) {
    s = { src: preview!.canvas, x: preview!.x ?? 0, y: preview!.y ?? 0 }
    if (preview!.extra) {
      const e = preview!.extra
      const x0 = Math.min(s.x, e.x), y0 = Math.min(s.y, e.y)
      const x1 = Math.max(s.x + s.src.width, e.x + e.src.width), y1 = Math.max(s.y + s.src.height, e.y + e.src.height)
      const c = makeCanvas(x1 - x0, y1 - y0)
      const g = ctx2d(c)
      g.drawImage(s.src, s.x - x0, s.y - y0)
      g.drawImage(e.src, e.x - x0, e.y - y0)
      s = { src: c, x: x0, y: y0 }
    }
  } else s = layerSource(l)
  if (s) {
    const m = activeMask(l, preview)
    if (m) {
      const c = makeCanvas(s.src.width, s.src.height)
      const g = ctx2d(c)
      g.drawImage(s.src, 0, 0)
      g.globalCompositeOperation = 'destination-in'
      g.drawImage(maskToAlpha(m.canvas, !m.live), m.x - s.x, m.y - s.y)
      s = { src: c, x: s.x, y: s.y }
    }
    if (hasFx(l)) s = applyFx(s, l)
  }
  if (!live) renderCache.set(l, { ver: S().ver, fontGen, s })
  return s
}

function applyAdjustLayer(g: CanvasRenderingContext2D, l: AdjustLayer, w: number, h: number, preview?: Preview | null) {
  const img = g.getImageData(0, 0, w, h)
  const m = activeMask(l, preview)
  if (!m) {
    applyAdjustment(img.data, l.adj, l.opacity)
  } else {
    const orig = img.data.slice()
    applyAdjustment(img.data, l.adj, l.opacity)
    const mc = makeCanvas(w, h)
    ctx2d(mc).drawImage(m.canvas, m.x, m.y)
    const md = ctx2d(mc, true).getImageData(0, 0, w, h).data
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      const k = md[i + 3] ? md[i] / 255 : 0
      if (k >= 1) continue
      d[i] = orig[i] + (d[i] - orig[i]) * k
      d[i + 1] = orig[i + 1] + (d[i + 1] - orig[i + 1]) * k
      d[i + 2] = orig[i + 2] + (d[i + 2] - orig[i + 2]) * k
    }
  }
  g.putImageData(img, 0, 0)
}

function drawOne(g: CanvasRenderingContext2D, l: Layer, w: number, h: number, preview?: Preview | null) {
  if (preview && preview.layerId === l.id && preview.hidden) return
  if (l.kind === 'adjust') return applyAdjustLayer(g, l, w, h, preview)
  const s = renderedLayer(l, preview)
  if (!s) return
  g.globalAlpha = l.opacity
  g.globalCompositeOperation = l.blend
  g.drawImage(s.src, s.x, s.y)
  g.globalAlpha = 1
  g.globalCompositeOperation = 'source-over'
}

/** True when the layer at i is drawn clipped to a base below it. */
export function isClipped(layers: Layer[], i: number): boolean {
  if (!layers[i]?.clip) return false
  let j = i - 1
  while (j >= 0 && layers[j].clip) j--
  return j >= 0 && layers[j].kind !== 'adjust'
}

/** Draws layers [from..] onto g (doc-sized), honoring opacity, blend modes, masks, clipping and adjustments. */
export function compositeLayers(g: CanvasRenderingContext2D, layers: Layer[], w: number, h: number, preview?: Preview | null, from = 0) {
  let i = from
  while (i < layers.length) {
    const base = layers[i]
    let j = i + 1
    if (base.kind !== 'adjust') while (j < layers.length && layers[j].clip) j++
    const clipped = layers.slice(i + 1, j)
    i = j
    if (!base.visible || base.opacity <= 0) continue
    if (!clipped.some(c => c.visible)) {
      drawOne(g, base, w, h, preview)
      continue
    }
    // Clipping group: paint the clipped layers only where the base has pixels.
    const bs = preview && preview.layerId === base.id && preview.hidden ? null : renderedLayer(base, preview)
    if (!bs) continue
    const grp = makeCanvas(w, h)
    const gg = ctx2d(grp)
    gg.drawImage(bs.src, bs.x, bs.y)
    for (const c of clipped) {
      if (!c.visible || c.opacity <= 0) continue
      if (c.kind === 'adjust') {
        applyAdjustLayer(gg, c, w, h, preview)
        continue
      }
      const cs = renderedLayer(c, preview)
      if (!cs) continue
      const tmp = makeCanvas(w, h)
      const tg = ctx2d(tmp)
      tg.drawImage(cs.src, cs.x, cs.y)
      tg.globalCompositeOperation = 'destination-in'
      tg.drawImage(bs.src, bs.x, bs.y)
      gg.globalAlpha = c.opacity
      gg.globalCompositeOperation = c.blend
      gg.drawImage(tmp, 0, 0)
      gg.globalAlpha = 1
      gg.globalCompositeOperation = 'source-over'
    }
    g.globalAlpha = base.opacity
    g.globalCompositeOperation = base.blend
    g.drawImage(grp, 0, 0)
    g.globalAlpha = 1
    g.globalCompositeOperation = 'source-over'
  }
}

// --- Cached document composite -------------------------------------------

let out: HTMLCanvasElement | null = null
let below: { canvas: HTMLCanvasElement; layers: Layer[]; idx: number; ver: number } | null = null

/** Full composite of the document into a shared canvas. */
export function compositeDoc(doc: Doc, ver: number, preview: Preview | null): HTMLCanvasElement {
  const { width: w, height: h } = doc
  if (!out || out.width !== w || out.height !== h) out = makeCanvas(w, h)
  const g = ctx2d(out)
  g.clearRect(0, 0, w, h)
  let idx = preview ? doc.layers.findIndex(l => l.id === preview.layerId) : -1
  while (idx > 0 && doc.layers[idx].clip) idx--
  if (idx > 0) {
    // Everything under the previewed layer is stable during a stroke; cache it.
    if (!below || below.layers !== doc.layers || below.idx !== idx || below.ver !== ver || below.canvas.width !== w || below.canvas.height !== h) {
      const c = below && below.canvas.width === w && below.canvas.height === h ? below.canvas : makeCanvas(w, h)
      const bg = ctx2d(c)
      bg.clearRect(0, 0, w, h)
      compositeLayers(bg, doc.layers.slice(0, idx), w, h)
      below = { canvas: c, layers: doc.layers, idx, ver }
    }
    g.drawImage(below.canvas, 0, 0)
    compositeLayers(g, doc.layers, w, h, preview, idx)
  } else {
    compositeLayers(g, doc.layers, w, h, preview)
  }
  return out
}

/** A fresh, standalone flattened canvas (for export / merge). */
export function flattenToCanvas(doc: Doc, layers = doc.layers): HTMLCanvasElement {
  const c = makeCanvas(doc.width, doc.height)
  compositeLayers(ctx2d(c), layers, doc.width, doc.height)
  return c
}

/** Bounds of a layer's content in doc space. */
export function layerBounds(l: Layer, doc: Doc): Rect {
  if (l.kind === 'raster') return { x: l.x, y: l.y, w: l.bmp.canvas.width, h: l.bmp.canvas.height }
  if (l.kind === 'text') return textLayout(l).box
  if (l.kind === 'shape') {
    const b = shapeBox(l)
    const p = l.stroke ? l.strokeWidth / 2 : 0
    return { x: b.x - p, y: b.y - p, w: b.w + p * 2, h: b.h + p * 2 }
  }
  return { x: 0, y: 0, w: doc.width, h: doc.height }
}
