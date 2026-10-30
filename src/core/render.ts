import { applyAdjustment } from './adjustments'
import { ctx2d, makeCanvas } from './bitmap'
import type { Doc, Layer, Rect, ShapeLayer, TextLayer } from './types'

export interface LayerSource {
  src: HTMLCanvasElement
  x: number
  y: number
}

/** Live replacement for one layer while a tool is working on it. */
export type Preview =
  | { layerId: string; canvas: HTMLCanvasElement; x: number; y: number; extra?: LayerSource }
  | { layerId: string; hidden: true }

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

/** Draws layers [from..] onto g (doc-sized), honoring opacity, blend modes and adjustment layers. */
export function compositeLayers(g: CanvasRenderingContext2D, layers: Layer[], w: number, h: number, preview?: Preview | null, from = 0) {
  for (let i = from; i < layers.length; i++) {
    const l = layers[i]
    if (!l.visible || l.opacity <= 0) continue
    if (l.kind === 'adjust') {
      const img = g.getImageData(0, 0, w, h)
      applyAdjustment(img.data, l.adj, l.opacity)
      g.putImageData(img, 0, 0)
      continue
    }
    let s: LayerSource | null
    let extra: LayerSource | undefined
    if (preview && preview.layerId === l.id) {
      if ('hidden' in preview) continue
      s = { src: preview.canvas, x: preview.x, y: preview.y }
      extra = preview.extra
    } else s = layerSource(l)
    if (!s) continue
    g.globalAlpha = l.opacity
    g.globalCompositeOperation = l.blend
    g.drawImage(s.src, s.x, s.y)
    if (extra) g.drawImage(extra.src, extra.x, extra.y)
  }
  g.globalAlpha = 1
  g.globalCompositeOperation = 'source-over'
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
  const idx = preview ? doc.layers.findIndex(l => l.id === preview.layerId) : -1
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
