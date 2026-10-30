import { readPsd, writePsdUint8Array, type Layer as PsdLayer, type Psd, type AdjustmentLayer, type BlendMode as PsdBlend } from 'ag-psd'
import { defaultAdjustment } from './adjustments'
import { ctx2d, makeCanvas, newBitmap, uid } from './bitmap'
import { flattenToCanvas, hasFx, layerSource, renderedLayer } from './render'
import type { Adjustment, BlendMode, Doc, Layer, LayerMask } from './types'

const TO_PSD: Record<BlendMode, PsdBlend> = {
  'source-over': 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten',
  'color-dodge': 'color dodge', 'color-burn': 'color burn', 'hard-light': 'hard light', 'soft-light': 'soft light',
  difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
}
const FROM_PSD = Object.fromEntries(Object.entries(TO_PSD).map(([k, v]) => [v, k])) as Record<string, BlendMode>

export interface PsdImport {
  doc: Doc
  /** Things we couldn't keep editable. */
  notes: string[]
}

function toAdjustment(a: AdjustmentLayer): Adjustment | null {
  switch (a.type) {
    case 'brightness/contrast':
      return { type: 'brightness', brightness: a.brightness ?? 0, contrast: a.contrast ?? 0 }
    case 'levels': {
      const c = a.channels?.[0]
      if (!c) return defaultAdjustment('levels')
      return { type: 'levels', inBlack: c.shadowInput, inWhite: c.highlightInput, gamma: c.midtoneInput || 1, outBlack: c.shadowOutput, outWhite: c.highlightOutput }
    }
    case 'curves': {
      const ch = (i: number): [number, number][] => {
        const pts = a.channels?.[i]
        return pts && pts.length >= 2 ? pts.map(p => [p.input, p.output]) : [[0, 0], [255, 255]]
      }
      return { type: 'curves', rgb: ch(0), r: ch(1), g: ch(2), b: ch(3) }
    }
    case 'exposure':
      return { type: 'exposure', exposure: a.exposure ?? 0, offset: a.offset ?? 0, gamma: a.gamma ?? 1 }
    case 'vibrance':
      return { type: 'vibrance', vibrance: a.vibrance ?? 0, saturation: a.saturation ?? 0 }
    case 'hue/saturation':
      return { type: 'hue', hue: a.master?.hue ?? 0, saturation: a.master?.saturation ?? 0, lightness: a.master?.lightness ?? 0 }
    case 'black & white':
      return { type: 'bw', reds: a.reds ?? 40, yellows: a.yellows ?? 60, greens: a.greens ?? 40, cyans: a.cyans ?? 60, blues: a.blues ?? 20, magentas: a.magentas ?? 80 }
    case 'invert':
      return { type: 'invert' }
  }
  return null
}

function fromAdjustment(a: Adjustment): AdjustmentLayer {
  switch (a.type) {
    case 'brightness': return { type: 'brightness/contrast', brightness: a.brightness, contrast: a.contrast }
    case 'levels': return { type: 'levels', channels: [{ shadowInput: a.inBlack, highlightInput: a.inWhite, midtoneInput: a.gamma, shadowOutput: a.outBlack, highlightOutput: a.outWhite }] }
    case 'curves': return { type: 'curves', channels: [a.rgb, a.r, a.g, a.b].map(c => c.map(([input, output]) => ({ input, output }))) }
    case 'exposure': return { type: 'exposure', exposure: a.exposure, offset: a.offset, gamma: a.gamma }
    case 'vibrance': return { type: 'vibrance', vibrance: a.vibrance, saturation: a.saturation }
    case 'hue': return { type: 'hue/saturation', master: { hue: a.hue, saturation: a.saturation, lightness: a.lightness } }
    case 'bw': return { type: 'black & white', reds: a.reds, yellows: a.yellows, greens: a.greens, cyans: a.cyans, blues: a.blues, magentas: a.magentas }
    case 'invert': return { type: 'invert' }
  }
}

export function importPsd(data: Uint8Array): PsdImport {
  const psd: Psd = readPsd(data, { skipThumbnail: true })
  const W = psd.width, H = psd.height
  const notes = new Set<string>()
  const layers: Layer[] = []

  const maskOf = (pl: PsdLayer): LayerMask | null => {
    const m = pl.mask
    if (!m || !m.canvas) return null
    const def = m.defaultColor ?? 255
    const bmp = newBitmap(W, H, `rgb(${def},${def},${def})`)
    ctx2d(bmp.canvas).drawImage(m.canvas, m.left ?? 0, m.top ?? 0)
    return { bmp, x: 0, y: 0, enabled: !m.disabled }
  }

  const walk = (list: PsdLayer[] | undefined, hiddenParent: boolean) => {
    for (const pl of list ?? []) {
      const hidden = hiddenParent || !!pl.hidden
      if (pl.children) {
        notes.add('groups were flattened into the layer list')
        walk(pl.children, hidden)
        continue
      }
      const blend = FROM_PSD[pl.blendMode ?? 'normal']
      if (pl.blendMode && !blend) notes.add(`blend mode "${pl.blendMode}" became Normal`)
      const base = {
        id: uid('layer'), name: pl.name || 'Layer', visible: !hidden, locked: false,
        opacity: pl.opacity ?? 1, blend: blend ?? ('source-over' as BlendMode), mask: maskOf(pl), clip: !!pl.clipping,
      }
      if (pl.adjustment) {
        const adj = toAdjustment(pl.adjustment)
        if (adj) layers.push({ ...base, kind: 'adjust', adj })
        else notes.add(`"${pl.adjustment.type}" adjustments were skipped`)
        continue
      }
      if (pl.text) notes.add('text layers came in as pixels')
      if (pl.effects) notes.add('layer effects were baked into pixels or dropped')
      const c = pl.canvas
      if (!c || !c.width || !c.height) continue
      layers.push({ ...base, kind: 'raster', bmp: { id: uid('bmp'), canvas: c }, x: pl.left ?? 0, y: pl.top ?? 0 })
    }
  }
  walk(psd.children, false)

  if (!layers.length && psd.canvas) {
    layers.push({ id: uid('layer'), name: 'Background', visible: true, locked: false, opacity: 1, blend: 'source-over', kind: 'raster', bmp: { id: uid('bmp'), canvas: psd.canvas }, x: 0, y: 0 })
  }
  const doc: Doc = { width: W, height: H, layers, activeId: layers[layers.length - 1]?.id ?? null, selection: null, guides: { h: [], v: [] } }
  return { doc, notes: [...notes] }
}

export function exportPsd(doc: Doc): Uint8Array {
  const children: PsdLayer[] = []
  for (const l of doc.layers) {
    const base: PsdLayer = { name: l.name, hidden: !l.visible, opacity: l.opacity, blendMode: TO_PSD[l.blend], clipping: !!l.clip }
    const maskData = (bake: boolean) => {
      if (!l.mask || bake) return undefined
      return { canvas: l.mask.bmp.canvas, left: l.mask.x, top: l.mask.y, defaultColor: 0, disabled: !l.mask.enabled }
    }
    if (l.kind === 'adjust') {
      children.push({ ...base, adjustment: fromAdjustment(l.adj), mask: maskData(false) })
      continue
    }
    // Effects have no editable PSD equivalent here, so bake them (and the mask) into pixels.
    const bake = hasFx(l)
    const s = bake ? renderedLayer(l) : layerSource(l)
    if (!s) continue
    const c = makeCanvas(s.src.width, s.src.height)
    ctx2d(c).drawImage(s.src, 0, 0)
    children.push({ ...base, canvas: c, left: Math.round(s.x), top: Math.round(s.y), mask: maskData(bake) })
  }
  const psd: Psd = { width: doc.width, height: doc.height, canvas: flattenToCanvas(doc), children }
  return writePsdUint8Array(psd, { generateThumbnail: true })
}
