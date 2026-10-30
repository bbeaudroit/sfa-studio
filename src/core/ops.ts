import { defaultAdjustment, adjustmentLabel } from './adjustments'
import { alphaBounds, bitmapFrom, cloneBitmap, ctx2d, makeCanvas, newBitmap, uid } from './bitmap'
import { compositeLayers, flattenToCanvas, layerSource, maskToAlpha, textLayout } from './render'
import { combineMasks, invertMask, maskBounds, rectMask, type SelMode } from './selection'
import {
  S, activeLayer, commit, editPixels, loadDoc, set, toast, updateDoc,
  type Patch,
} from './store'
import type { Adjustment, AdjustLayer, AdjustmentType, Bitmap, Doc, Layer, RasterLayer, Rect, ShapeLayer, TextLayer } from './types'
import { fitView } from './view'

const base = (name: string) => ({ id: uid('layer'), name, visible: true, locked: false, opacity: 1, blend: 'source-over' as const })

export function rasterLayer(name: string, bmp: Bitmap, x = 0, y = 0): RasterLayer {
  return { ...base(name), kind: 'raster', bmp, x, y }
}

function nextName(doc: Doc, prefix: string) {
  let n = 1
  const names = new Set(doc.layers.map(l => l.name))
  while (names.has(`${prefix} ${n}`)) n++
  return `${prefix} ${n}`
}

// --- Documents --------------------------------------------------------------

export function newDocument(w: number, h: number, fill: string | null, name = 'Untitled') {
  const bg = rasterLayer(fill ? 'Background' : 'Layer 1', newBitmap(w, h, fill ?? undefined))
  const doc: Doc = { width: w, height: h, layers: [bg], activeId: bg.id, selection: null, guides: { h: [], v: [] } }
  loadDoc(doc, name, null, 'New canvas')
  fitView()
}

export function docFromImage(img: CanvasImageSource & { width: number; height: number }, name: string, path: string | null) {
  const w = (img as HTMLImageElement).naturalWidth || img.width
  const h = (img as HTMLImageElement).naturalHeight || img.height
  const layer = rasterLayer(name.replace(/\.[^.]+$/, '') || 'Image', bitmapFrom(img, w, h))
  const doc: Doc = { width: w, height: h, layers: [layer], activeId: layer.id, selection: null, guides: { h: [], v: [] } }
  loadDoc(doc, name, path)
  fitView()
}

/** Places an image as a new layer, centered. */
export function placeImage(img: CanvasImageSource & { width: number; height: number }, name: string, at?: { x: number; y: number }) {
  const d = S().doc
  if (!d) return docFromImage(img, name, null)
  const w = (img as HTMLImageElement).naturalWidth || img.width
  const h = (img as HTMLImageElement).naturalHeight || img.height
  const x = at ? Math.round(at.x) : Math.round((d.width - w) / 2)
  const y = at ? Math.round(at.y) : Math.round((d.height - h) / 2)
  const layer = rasterLayer(name.replace(/\.[^.]+$/, '') || nextName(d, 'Layer'), bitmapFrom(img, w, h), x, y)
  insertAbove(layer, `Place ${layer.name}`)
}

function insertAbove(layer: Layer, label: string) {
  updateDoc(d => {
    const i = d.layers.findIndex(l => l.id === d.activeId)
    const layers = [...d.layers]
    layers.splice(i + 1, 0, layer)
    return { ...d, layers, activeId: layer.id }
  }, label)
}

// --- Layers -----------------------------------------------------------------

export function addLayer() {
  const d = S().doc
  if (!d) return
  insertAbove(rasterLayer(nextName(d, 'Layer'), newBitmap(d.width, d.height)), 'New layer')
}

export function addAdjustment(type: AdjustmentType) {
  const d = S().doc
  if (!d) return
  const l: AdjustLayer = { ...base(adjustmentLabel(type)), kind: 'adjust', adj: defaultAdjustment(type) }
  insertAbove(l, adjustmentLabel(type))
}

/** Auto contrast (luminance levels) or auto tone (per-channel curves), as an editable adjustment layer. */
export function autoAdjust(kind: 'contrast' | 'tone') {
  const d = S().doc
  if (!d) return
  const i = d.layers.findIndex(l => l.id === d.activeId)
  const flat = flattenToCanvas(d, d.layers.slice(0, i + 1))
  const k = Math.min(1, 600 / Math.max(d.width, d.height))
  const sm = makeCanvas(d.width * k, d.height * k)
  ctx2d(sm).drawImage(flat, 0, 0, sm.width, sm.height)
  const px = ctx2d(sm, true).getImageData(0, 0, sm.width, sm.height).data
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]
  let n = 0
  for (let j = 0; j < px.length; j += 4) {
    if (px[j + 3] < 8) continue
    n++
    hist[0][px[j]]++
    hist[1][px[j + 1]]++
    hist[2][px[j + 2]]++
    hist[3][(px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8]++
  }
  if (!n) return toast('Nothing to analyze')
  const clip = n * 0.001
  const range = (h: Uint32Array): [number, number] => {
    let lo = 0, hi = 255, acc = 0
    while (lo < 254 && (acc += h[lo]) <= clip) lo++
    acc = 0
    while (hi > lo + 1 && (acc += h[hi]) <= clip) hi--
    return [lo, hi]
  }
  let adj: Adjustment
  if (kind === 'contrast') {
    const [lo, hi] = range(hist[3])
    adj = { type: 'levels', inBlack: lo, inWhite: hi, gamma: 1, outBlack: 0, outWhite: 255 }
  } else {
    const ch = (h: Uint32Array): [number, number][] => { const [lo, hi] = range(h); return [[lo, 0], [hi, 255]] }
    adj = { type: 'curves', rgb: [[0, 0], [255, 255]], r: ch(hist[0]), g: ch(hist[1]), b: ch(hist[2]) }
  }
  const name = kind === 'contrast' ? 'Auto contrast' : 'Auto tone'
  insertAbove({ ...base(name), kind: 'adjust', adj }, name)
}

export function addText(x: number, y: number, text = 'Text'): TextLayer {
  const o = S().opts.text
  const l: TextLayer = {
    ...base(text.slice(0, 24)), kind: 'text', x, y, text, font: o.font, size: o.size, weight: o.weight,
    italic: false, color: S().fg, align: o.align, lineHeight: 1.2,
  }
  insertAbove(l, 'New text')
  return l
}

export function addShapeSilent(l: ShapeLayer) {
  set(s => {
    const d = s.doc!
    const i = d.layers.findIndex(x => x.id === d.activeId)
    const layers = [...d.layers]
    layers.splice(i + 1, 0, l)
    return { doc: { ...d, layers, activeId: l.id } }
  })
}

export function newShape(shape: ShapeLayer['shape'], x: number, y: number): ShapeLayer {
  const o = S().opts.shape
  const s = S()
  const isLine = shape === 'line'
  return {
    ...base(shape === 'rect' ? 'Rectangle' : shape === 'ellipse' ? 'Ellipse' : 'Line'),
    kind: 'shape', shape, x, y, w: 0, h: 0,
    fill: o.fill && !isLine ? s.fg : null,
    stroke: o.stroke || isLine ? (isLine ? s.fg : s.bg) : null,
    strokeWidth: o.strokeWidth, radius: o.radius,
  }
}

export function selectLayer(id: string) {
  updateDoc(d => ({ ...d, activeId: id }))
}

export function deleteLayer(id = S().doc?.activeId) {
  const d = S().doc
  if (!d || !id) return
  if (d.layers.length === 1) return toast('A document needs at least one layer')
  updateDoc(d => {
    const i = d.layers.findIndex(l => l.id === id)
    const layers = d.layers.filter(l => l.id !== id)
    const activeId = d.activeId === id ? layers[Math.max(0, i - 1)].id : d.activeId
    return { ...d, layers, activeId }
  }, 'Delete layer')
}

function cloneLayer(l: Layer, name?: string): Layer {
  const id = uid('layer')
  const mask = l.mask ? { ...l.mask, bmp: cloneBitmap(l.mask.bmp) } : l.mask
  if (l.kind === 'raster') return { ...l, id, mask, name: name ?? `${l.name} copy`, bmp: bitmapFrom(l.bmp.canvas, l.bmp.canvas.width, l.bmp.canvas.height) }
  return { ...l, id, mask, name: name ?? `${l.name} copy` } as Layer
}

/** Ctrl+J: duplicates the layer, or copies the selected pixels into a new layer. */
export function duplicateLayer() {
  const d = S().doc
  const l = activeLayer()
  if (!d || !l) return
  if (d.selection && l.kind === 'raster') {
    const c = makeCanvas(l.bmp.canvas.width, l.bmp.canvas.height)
    const g = ctx2d(c)
    g.drawImage(l.bmp.canvas, 0, 0)
    g.globalCompositeOperation = 'destination-in'
    g.drawImage(d.selection.canvas, -l.x, -l.y)
    insertAbove(rasterLayer(nextName(d, 'Layer'), { id: uid('bmp'), canvas: c }, l.x, l.y), 'Layer via copy')
    return
  }
  insertAbove(cloneLayer(l), 'Duplicate layer')
}

export function moveLayer(id: string, toIndex: number) {
  updateDoc(d => {
    const from = d.layers.findIndex(l => l.id === id)
    if (from < 0 || from === toIndex) return d
    const layers = [...d.layers]
    const [l] = layers.splice(from, 1)
    layers.splice(Math.max(0, Math.min(layers.length, toIndex)), 0, l)
    return { ...d, layers }
  }, 'Reorder layers')
}

export function stepLayer(dir: 1 | -1) {
  const d = S().doc
  if (!d) return
  const i = d.layers.findIndex(l => l.id === d.activeId)
  const j = i + dir
  if (j < 0 || j >= d.layers.length) return
  moveLayer(d.activeId!, j)
}

/** Converts any layer to a doc-sized raster layer, keeping id and properties. */
export function rasterOf(l: Layer, d: Doc): RasterLayer {
  if (l.kind === 'raster') return l
  const bmp = newBitmap(d.width, d.height)
  const s = layerSource(l)
  if (s) ctx2d(bmp.canvas).drawImage(s.src, s.x, s.y)
  const { id, name, visible, locked, opacity, blend, mask, clip, fx } = l
  return { id, name, visible, locked, opacity, blend, mask, clip, fx, kind: 'raster', bmp, x: 0, y: 0 }
}

export function rasterize(id = S().doc?.activeId) {
  updateDoc(d => ({ ...d, layers: d.layers.map(l => (l.id === id && (l.kind === 'text' || l.kind === 'shape') ? rasterOf(l, d) : l)) }), 'Rasterize')
}

export function mergeDown() {
  const d = S().doc
  if (!d) return
  const i = d.layers.findIndex(l => l.id === d.activeId)
  if (i <= 0) return toast('Nothing below to merge into')
  const top = d.layers[i], low = d.layers[i - 1]
  if (low.kind === 'adjust') return toast('Can’t merge into an adjustment layer')
  const c = makeCanvas(d.width, d.height)
  // Bottom at full strength, top with its own opacity/blend; result keeps the lower layer's settings.
  compositeLayers(ctx2d(c), [{ ...low, opacity: 1, blend: 'source-over', visible: true }, top], d.width, d.height)
  // Mask and effects of the lower layer are baked into the merged pixels.
  const merged: RasterLayer = { ...rasterOf(low, d), bmp: { id: uid('bmp'), canvas: c }, x: 0, y: 0, mask: null, fx: undefined }
  updateDoc(d => {
    const layers = [...d.layers]
    layers.splice(i - 1, 2, merged)
    return { ...d, layers, activeId: merged.id }
  }, 'Merge down')
}

export function flatten() {
  const d = S().doc
  if (!d) return
  const flat = rasterLayer('Background', { id: uid('bmp'), canvas: flattenToCanvas(d) })
  updateDoc(d => ({ ...d, layers: [flat], activeId: flat.id }), 'Flatten')
}

export function mergeVisible() {
  const d = S().doc
  if (!d) return
  const flat = rasterLayer('Merged', { id: uid('bmp'), canvas: flattenToCanvas(d) })
  updateDoc(d => ({ ...d, layers: [...d.layers.filter(l => !l.visible), flat], activeId: flat.id }), 'Merge visible')
}

// --- Selection --------------------------------------------------------------

export function setSelection(mask: Bitmap | null, mode: SelMode = 'new', label = 'Selection') {
  const d = S().doc
  if (!d) return
  const sel = mask ? combineMasks(d.selection, mask, mode) : null
  if (!sel && !d.selection) return
  updateDoc(d => ({ ...d, selection: sel }), sel ? label : 'Deselect')
}

export const selectAll = () => {
  const d = S().doc
  if (d) setSelection(rectMask(d.width, d.height, { x: 0, y: 0, w: d.width, h: d.height }), 'new', 'Select all')
}
export const deselect = () => setSelection(null)
export function invertSelection() {
  const d = S().doc
  if (!d?.selection) return
  updateDoc(d => ({ ...d, selection: invertMask(d.selection, d.width, d.height) }), 'Invert selection')
}

/** Selects the opaque pixels of a layer (Ctrl+click thumbnail). */
export function selectLayerPixels(id: string) {
  const d = S().doc
  const l = d?.layers.find(x => x.id === id)
  if (!d || !l) return
  const s = layerSource(l)
  if (!s) return
  const m = newBitmap(d.width, d.height)
  ctx2d(m.canvas).drawImage(s.src, s.x, s.y)
  setSelection(m, 'new', 'Load selection')
}

// --- Pixel editing ----------------------------------------------------------

/** Returns the active raster layer ready for pixel edits, or explains why not. */
export function editableRaster(): RasterLayer | null {
  const l = activeLayer()
  if (!l) return null
  if (l.locked) {
    toast('Layer is locked')
    return null
  }
  if (!l.visible) {
    toast('Layer is hidden')
    return null
  }
  if (l.kind === 'text' || l.kind === 'shape') {
    toast(`${l.kind === 'text' ? 'Text' : 'Shape'} layers stay editable. Rasterize to paint.`, { label: 'Rasterize', run: () => rasterize(l.id) })
    return null
  }
  if (l.kind === 'adjust') {
    toast('Pick a pixel layer to paint on')
    return null
  }
  return coverDoc(l)
}

/** Grows a raster layer so it covers the whole canvas (needed after moves/canvas resizes). */
function coverDoc(l: RasterLayer): RasterLayer {
  const d = S().doc!
  const { width: w, height: h } = l.bmp.canvas
  if (l.x <= 0 && l.y <= 0 && l.x + w >= d.width && l.y + h >= d.height) return l
  const x0 = Math.min(0, l.x), y0 = Math.min(0, l.y)
  const x1 = Math.max(d.width, l.x + w), y1 = Math.max(d.height, l.y + h)
  const bmp = newBitmap(x1 - x0, y1 - y0)
  ctx2d(bmp.canvas).drawImage(l.bmp.canvas, l.x - x0, l.y - y0)
  const nl: RasterLayer = { ...l, bmp, x: x0, y: y0 }
  set({ doc: { ...d, layers: d.layers.map(x => (x.id === l.id ? nl : x)) } })
  return nl
}

/** Where pixel tools draw: the active layer's pixels, or its mask while the mask is being edited. */
export interface PaintTarget {
  layer: Layer
  bmp: Bitmap
  x: number
  y: number
  isMask: boolean
}

export function paintTarget(): PaintTarget | null {
  const l = activeLayer()
  if (!l) return null
  if (S().editMask && l.mask) {
    if (l.locked) {
      toast('Layer is locked')
      return null
    }
    return { layer: l, bmp: l.mask.bmp, x: l.mask.x, y: l.mask.y, isMask: true }
  }
  const r = editableRaster()
  return r ? { layer: r, bmp: r.bmp, x: r.x, y: r.y, isMask: false } : null
}

/** Masks are grayscale: map a paint color to its luminance. */
export function grayOf(hex: string): string {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16) || 0
  const v = Math.round(((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114)
  const h = v.toString(16).padStart(2, '0')
  return `#${h}${h}${h}`
}

/** Selection bounds in target-local space, or null when nothing is selected. */
export function selectionRectFor(l: { x: number; y: number }): Rect | null {
  const sel = S().doc?.selection
  if (!sel) return null
  const b = maskBounds(sel)
  return b ? { x: b.x - l.x, y: b.y - l.y, w: b.w, h: b.h } : null
}

/**
 * Runs a pixel operation on the active layer, limited to the selection.
 * `fn` draws the processed result for the given source canvas.
 */
export function filterActive(label: string, fn: (src: HTMLCanvasElement) => HTMLCanvasElement) {
  const l = paintTarget()
  if (!l) return
  const sel = S().doc!.selection
  const result = fn(l.bmp.canvas)
  const rect = selectionRectFor(l)
  const patch = editPixels(l.bmp, rect, g => {
    if (!sel) {
      g.clearRect(0, 0, l.bmp.canvas.width, l.bmp.canvas.height)
      g.drawImage(result, 0, 0)
      return
    }
    const masked = makeCanvas(result.width, result.height)
    const mg = ctx2d(masked)
    mg.drawImage(result, 0, 0)
    mg.globalCompositeOperation = 'destination-in'
    mg.drawImage(sel.canvas, -l.x, -l.y)
    g.globalCompositeOperation = 'destination-out'
    g.drawImage(sel.canvas, -l.x, -l.y)
    g.globalCompositeOperation = 'source-over'
    g.drawImage(masked, 0, 0)
  })
  commit(label, patch ? [patch] : [])
}

export function clearSelected() {
  const d = S().doc
  if (!d) return
  if (!d.selection) return deleteLayer()
  const l = paintTarget()
  if (!l) return
  if (l.isMask) return fillSelection('#000000')
  const patch = editPixels(l.bmp, selectionRectFor(l), g => {
    g.globalCompositeOperation = 'destination-out'
    g.drawImage(d.selection!.canvas, -l.x, -l.y)
    g.globalCompositeOperation = 'source-over'
  })
  commit('Clear', patch ? [patch] : [])
}

export function fillSelection(color: string) {
  const l = paintTarget()
  if (!l) return
  if (l.isMask) color = grayOf(color)
  const d = S().doc!
  const patch = editPixels(l.bmp, selectionRectFor(l), g => {
    if (!d.selection) {
      g.fillStyle = color
      g.fillRect(0, 0, l.bmp.canvas.width, l.bmp.canvas.height)
      return
    }
    const c = makeCanvas(d.width, d.height)
    const cg = ctx2d(c)
    cg.fillStyle = color
    cg.fillRect(0, 0, d.width, d.height)
    cg.globalCompositeOperation = 'destination-in'
    cg.drawImage(d.selection.canvas, 0, 0)
    g.drawImage(c, -l.x, -l.y)
  })
  commit('Fill', patch ? [patch] : [])
}

// --- Masks & clipping ---------------------------------------------------------

export function addMask(mode: 'reveal' | 'hide' | 'selection' = S().doc?.selection ? 'selection' : 'reveal') {
  const d = S().doc
  const l = activeLayer()
  if (!d || !l) return
  if (l.mask) return set({ editMask: true })
  const bmp = newBitmap(d.width, d.height, mode === 'reveal' ? '#ffffff' : '#000000')
  if (mode === 'selection' && d.selection) ctx2d(bmp.canvas).drawImage(d.selection.canvas, 0, 0)
  updateDoc(d => ({ ...d, layers: d.layers.map(x => (x.id === l.id ? ({ ...x, mask: { bmp, x: 0, y: 0, enabled: true } } as Layer) : x)) }), 'Add mask')
  set({ editMask: true })
}

export function deleteMask(id = S().doc?.activeId) {
  updateDoc(d => ({ ...d, layers: d.layers.map(x => (x.id === id ? ({ ...x, mask: null } as Layer) : x)) }), 'Delete mask')
  set({ editMask: false })
}

export function toggleMask(id = S().doc?.activeId) {
  const l = S().doc?.layers.find(x => x.id === id)
  if (!l?.mask) return
  updateDoc(d => ({ ...d, layers: d.layers.map(x => (x.id === id ? ({ ...x, mask: { ...x.mask!, enabled: !x.mask!.enabled } } as Layer) : x)) }), l.mask.enabled ? 'Disable mask' : 'Enable mask')
}

/** Bakes the mask into the layer's pixels. */
export function applyMask() {
  const d = S().doc
  const l = activeLayer()
  if (!d || !l?.mask) return
  if (l.kind === 'adjust') return toast('Adjustment layers keep their mask')
  const r = rasterOf(l, d)
  const c = makeCanvas(r.bmp.canvas.width, r.bmp.canvas.height)
  const g = ctx2d(c)
  g.drawImage(r.bmp.canvas, 0, 0)
  g.globalCompositeOperation = 'destination-in'
  g.drawImage(maskToAlpha(l.mask.bmp.canvas, false), l.mask.x - r.x, l.mask.y - r.y)
  const nl: RasterLayer = { ...r, bmp: { id: uid('bmp'), canvas: c }, mask: null }
  updateDoc(d => ({ ...d, layers: d.layers.map(x => (x.id === l.id ? nl : x)) }), 'Apply mask')
  set({ editMask: false })
}

export function toggleClip(id = S().doc?.activeId) {
  const d = S().doc
  const i = d?.layers.findIndex(x => x.id === id) ?? -1
  if (!d || i < 0) return
  const l = d.layers[i]
  if (!l.clip && i === 0) return toast('Needs a layer below to clip to')
  updateDoc(d => ({ ...d, layers: d.layers.map(x => (x.id === id ? ({ ...x, clip: !x.clip } as Layer) : x)) }), l.clip ? 'Release clipping mask' : 'Clipping mask')
}

/** Moves a layer (and its mask) by dx, dy. */
export function shiftLayer<L extends Layer>(l: L, dx: number, dy: number): L {
  const mask = l.mask ? { ...l.mask, x: l.mask.x + dx, y: l.mask.y + dy } : l.mask
  if (l.kind === 'adjust') return { ...l, mask }
  return { ...l, mask, x: (l as RasterLayer).x + dx, y: (l as RasterLayer).y + dy }
}

/** Redraws a mask onto a new canvas through a transform (rotate/flip/resize). */
function remapMask(m: Layer['mask'], w: number, h: number, setup: (g: CanvasRenderingContext2D) => void): Layer['mask'] {
  if (!m) return m
  const bmp = newBitmap(w, h, '#000000')
  const g = ctx2d(bmp.canvas)
  g.imageSmoothingQuality = 'high'
  setup(g)
  g.drawImage(m.bmp.canvas, m.x, m.y)
  return { ...m, bmp, x: 0, y: 0 }
}

function withMasks(src: Layer[], out: Layer[], w: number, h: number, setup: (g: CanvasRenderingContext2D) => void): Layer[] {
  return out.map((l, i) => (src[i].mask ? ({ ...l, mask: remapMask(src[i].mask, w, h, setup) } as Layer) : l))
}

export function commitPatches(label: string, patches: (Patch | null)[]) {
  commit(label, patches.filter(Boolean) as Patch[])
}

// --- Clipboard --------------------------------------------------------------

let internalClip: { canvas: HTMLCanvasElement; x: number; y: number } | null = null

export async function copy(cut = false, merged = false) {
  const d = S().doc
  const l = activeLayer()
  if (!d || !l) return
  const src = merged ? flattenToCanvas(d) : null
  const s = merged ? { src: src!, x: 0, y: 0 } : layerSource(l)
  if (!s) return
  const area = d.selection ? maskBounds(d.selection) : merged ? { x: 0, y: 0, w: d.width, h: d.height } : alphaBoundsDoc(s.src, s.x, s.y)
  if (!area) return toast('Nothing to copy')
  const c = makeCanvas(area.w, area.h)
  const g = ctx2d(c)
  g.drawImage(s.src, s.x - area.x, s.y - area.y)
  if (d.selection) {
    g.globalCompositeOperation = 'destination-in'
    g.drawImage(d.selection.canvas, -area.x, -area.y)
  }
  internalClip = { canvas: c, x: area.x, y: area.y }
  try {
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'))
    if (blob) await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  } catch { /* internal clipboard still works */ }
  if (cut) clearSelected()
}

function alphaBoundsDoc(c: HTMLCanvasElement, x: number, y: number): Rect | null {
  const b = alphaBounds(c)
  return b ? { x: b.x + x, y: b.y + y, w: b.w, h: b.h } : null
}

export async function pasteInternal(): Promise<boolean> {
  if (!internalClip) return false
  const c = internalClip
  if (!S().doc) docFromImage(c.canvas, 'Pasted', null)
  else placeImage(c.canvas, 'Pasted', { x: c.x, y: c.y })
  return true
}

export function hasInternalClip() {
  return !!internalClip
}

// --- Image transforms -------------------------------------------------------

function mapRaster(l: RasterLayer, w: number, h: number, draw: (g: CanvasRenderingContext2D, l: RasterLayer) => void, x = 0, y = 0): RasterLayer {
  const bmp = newBitmap(w, h)
  draw(ctx2d(bmp.canvas), l)
  return { ...l, bmp, x, y }
}

export function rotateCanvas(deg: 90 | -90 | 180) {
  const d = S().doc
  if (!d) return
  const W = d.width, H = d.height
  const nw = deg === 180 ? W : H, nh = deg === 180 ? H : W
  let rasterized = false
  const layers = d.layers.map(l0 => {
    let l = l0
    if (l.kind === 'text') { l = rasterOf(l, d); rasterized = true }
    if (l.kind === 'shape') {
      const pt = (x: number, y: number) => (deg === 90 ? [H - y, x] : deg === -90 ? [y, W - x] : [W - x, H - y])
      const [ax, ay] = pt(l.x, l.y), [bx, by] = pt(l.x + l.w, l.y + l.h)
      return { ...l, x: ax, y: ay, w: bx - ax, h: by - ay }
    }
    if (l.kind !== 'raster') return l
    return mapRaster(l, nw, nh, (g, l) => {
      g.translate(nw / 2, nh / 2)
      g.rotate((deg * Math.PI) / 180)
      g.translate(-W / 2, -H / 2)
      g.drawImage(l.bmp.canvas, l.x, l.y)
    })
  })
  const layersM = withMasks(d.layers, layers, nw, nh, g => {
    g.translate(nw / 2, nh / 2)
    g.rotate((deg * Math.PI) / 180)
    g.translate(-W / 2, -H / 2)
  })
  const guides = deg === 180 ? { h: d.guides.h.map(y => H - y), v: d.guides.v.map(x => W - x) } : { h: d.guides.v.map(x => (deg === 90 ? x : W - x)), v: d.guides.h.map(y => (deg === 90 ? H - y : y)) }
  updateDoc(() => ({ ...d, width: nw, height: nh, layers: layersM, selection: null, guides }), deg === 180 ? 'Rotate 180°' : deg === 90 ? 'Rotate 90° CW' : 'Rotate 90° CCW')
  if (rasterized) toast('Text layers were rasterized')
  fitView()
}

export function flipCanvas(axis: 'h' | 'v') {
  const d = S().doc
  if (!d) return
  const W = d.width, H = d.height
  let rasterized = false
  const layers = d.layers.map(l0 => {
    let l = l0
    if (l.kind === 'text') { l = rasterOf(l, d); rasterized = true }
    if (l.kind === 'shape') return axis === 'h' ? { ...l, x: W - l.x, w: -l.w } : { ...l, y: H - l.y, h: -l.h }
    if (l.kind !== 'raster') return l
    return flipRaster(l, axis, W, H)
  })
  const guides = axis === 'h' ? { ...d.guides, v: d.guides.v.map(x => W - x) } : { ...d.guides, h: d.guides.h.map(y => H - y) }
  const layersM = withMasks(d.layers, layers, W, H, g => {
    if (axis === 'h') { g.translate(W, 0); g.scale(-1, 1) } else { g.translate(0, H); g.scale(1, -1) }
  })
  updateDoc(() => ({ ...d, layers: layersM, guides, selection: null }), axis === 'h' ? 'Flip horizontal' : 'Flip vertical')
  if (rasterized) toast('Text layers were rasterized')
}

function flipRaster(l: RasterLayer, axis: 'h' | 'v', W: number, H: number): RasterLayer {
  const { width: w, height: h } = l.bmp.canvas
  const nx = axis === 'h' ? W - l.x - w : l.x
  const ny = axis === 'v' ? H - l.y - h : l.y
  return mapRaster(l, w, h, (g, l) => {
    if (axis === 'h') { g.translate(w, 0); g.scale(-1, 1) } else { g.translate(0, h); g.scale(1, -1) }
    g.drawImage(l.bmp.canvas, 0, 0)
  }, nx, ny)
}

export function flipLayer(axis: 'h' | 'v') {
  const d = S().doc
  const l = activeLayer()
  if (!d || !l || l.locked) return
  if (l.kind === 'adjust') return
  if (l.kind === 'shape') {
    const b = { x: Math.min(l.x, l.x + l.w), y: Math.min(l.y, l.y + l.h), w: Math.abs(l.w), h: Math.abs(l.h) }
    const nl = axis === 'h' ? { ...l, x: b.x * 2 + b.w - l.x, w: -l.w } : { ...l, y: b.y * 2 + b.h - l.y, h: -l.h }
    return updateDoc(d => ({ ...d, layers: d.layers.map(x => (x.id === l.id ? nl : x)) }), 'Flip layer')
  }
  const r = l.kind === 'raster' ? l : rasterOf(l, d)
  const b = alphaBounds(r.bmp.canvas) ?? { x: 0, y: 0, w: r.bmp.canvas.width, h: r.bmp.canvas.height }
  // Flip around the content's own center so it stays in place.
  const { width: w, height: h } = r.bmp.canvas
  const nl = mapRaster(r, w, h, (g, l) => {
    if (axis === 'h') { g.translate(b.x * 2 + b.w, 0); g.scale(-1, 1) } else { g.translate(0, b.y * 2 + b.h); g.scale(1, -1) }
    g.drawImage(l.bmp.canvas, 0, 0)
  }, r.x, r.y)
  updateDoc(d => ({ ...d, layers: d.layers.map(x => (x.id === l.id ? nl : x)) }), 'Flip layer')
}

export function resizeImage(nw: number, nh: number) {
  const d = S().doc
  if (!d) return
  const sx = nw / d.width, sy = nh / d.height
  const layers = d.layers.map((l): Layer => {
    if (l.kind === 'raster') {
      const w = Math.max(1, Math.round(l.bmp.canvas.width * sx)), h = Math.max(1, Math.round(l.bmp.canvas.height * sy))
      return mapRaster(l, w, h, (g, l) => {
        g.imageSmoothingQuality = 'high'
        g.drawImage(l.bmp.canvas, 0, 0, w, h)
      }, Math.round(l.x * sx), Math.round(l.y * sy))
    }
    if (l.kind === 'text') return { ...l, x: l.x * sx, y: l.y * sy, size: l.size * Math.sqrt(sx * sy) }
    if (l.kind === 'shape') return { ...l, x: l.x * sx, y: l.y * sy, w: l.w * sx, h: l.h * sy, strokeWidth: l.strokeWidth * Math.sqrt(sx * sy) }
    return l
  })
  const guides = { h: d.guides.h.map(y => y * sy), v: d.guides.v.map(x => x * sx) }
  const layersM = withMasks(d.layers, layers, nw, nh, g => g.scale(sx, sy))
  updateDoc(() => ({ ...d, width: nw, height: nh, layers: layersM, selection: null, guides }), 'Image size')
  fitView()
}

/** anchor: 0..2 for x and y (0 = left/top). */
export function resizeCanvas(nw: number, nh: number, ax: number, ay: number) {
  const d = S().doc
  if (!d) return
  const dx = Math.round(((nw - d.width) * ax) / 2), dy = Math.round(((nh - d.height) * ay) / 2)
  shiftDoc(d, nw, nh, dx, dy, false, 'Canvas size')
  fitView()
}

export function crop(r: Rect, deletePixels: boolean) {
  const d = S().doc
  if (!d) return
  const x = Math.round(r.x), y = Math.round(r.y)
  if (x === 0 && y === 0 && Math.round(r.w) === d.width && Math.round(r.h) === d.height) return
  shiftDoc(d, Math.max(1, Math.round(r.w)), Math.max(1, Math.round(r.h)), -x, -y, deletePixels, 'Crop')
}

function shiftDoc(d: Doc, nw: number, nh: number, dx: number, dy: number, trim: boolean, label: string) {
  const layers = d.layers.map((l): Layer => {
    if (l.kind === 'raster' && trim) {
      const r = mapRaster(l, nw, nh, (g, l) => g.drawImage(l.bmp.canvas, l.x + dx, l.y + dy))
      return { ...r, mask: remapMask(l.mask, nw, nh, g => g.translate(dx, dy)) }
    }
    return shiftLayer(l, dx, dy)
  })
  let selection: Bitmap | null = null
  if (d.selection) {
    const m = newBitmap(nw, nh)
    ctx2d(m.canvas).drawImage(d.selection.canvas, dx, dy)
    selection = maskBounds(m) ? m : null
  }
  const guides = { h: d.guides.h.map(v => v + dy).filter(v => v >= 0 && v <= nh), v: d.guides.v.map(v => v + dx).filter(v => v >= 0 && v <= nw) }
  updateDoc(() => ({ ...d, width: nw, height: nh, layers, selection, guides }), label)
}

export function cropToSelection() {
  const d = S().doc
  if (!d?.selection) return toast('Make a selection first')
  const b = maskBounds(d.selection)
  if (b) {
    crop(b, true)
    fitView()
  }
}

export function trimTransparent() {
  const d = S().doc
  if (!d) return
  const b = alphaBounds(flattenToCanvas(d))
  if (!b) return toast('Canvas is empty')
  crop(b, false)
  fitView()
}

export function textBox(l: TextLayer) {
  return textLayout(l).box
}
