export type BlendMode =
  | 'source-over' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference'
  | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity'

export const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: 'source-over', label: 'Normal' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'darken', label: 'Darken' },
  { id: 'color-burn', label: 'Color burn' },
  { id: 'screen', label: 'Screen' },
  { id: 'lighten', label: 'Lighten' },
  { id: 'color-dodge', label: 'Color dodge' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'soft-light', label: 'Soft light' },
  { id: 'hard-light', label: 'Hard light' },
  { id: 'difference', label: 'Difference' },
  { id: 'exclusion', label: 'Exclusion' },
  { id: 'hue', label: 'Hue' },
  { id: 'saturation', label: 'Saturation' },
  { id: 'color', label: 'Color' },
  { id: 'luminosity', label: 'Luminosity' },
]

/** Mutable pixel store. Layers reference it; history patches write into it. */
export interface Bitmap {
  id: string
  canvas: HTMLCanvasElement
}

/** Grayscale mask in doc space: white shows the layer, black hides it. */
export interface LayerMask {
  bmp: Bitmap
  x: number
  y: number
  enabled: boolean
}

export interface ShadowFx { on: boolean; color: string; opacity: number; angle: number; distance: number; size: number }
export interface GlowFx { on: boolean; color: string; opacity: number; size: number }
export interface StrokeFx { on: boolean; color: string; opacity: number; size: number }

export interface LayerFx {
  shadow?: ShadowFx
  glow?: GlowFx
  stroke?: StrokeFx
}

interface LayerBase {
  id: string
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  blend: BlendMode
  mask?: LayerMask | null
  /** Clipped to the layer below (clipping mask). */
  clip?: boolean
  fx?: LayerFx
}

export interface RasterLayer extends LayerBase {
  kind: 'raster'
  bmp: Bitmap
  x: number
  y: number
}

export interface TextLayer extends LayerBase {
  kind: 'text'
  x: number
  y: number
  text: string
  font: string
  size: number
  weight: number
  italic: boolean
  color: string
  align: 'left' | 'center' | 'right'
  lineHeight: number
}

export type ShapeKind = 'rect' | 'ellipse' | 'line'

export interface ShapeLayer extends LayerBase {
  kind: 'shape'
  shape: ShapeKind
  /** rect/ellipse: box. line: start = (x,y), end = (x+w, y+h). */
  x: number
  y: number
  w: number
  h: number
  fill: string | null
  stroke: string | null
  strokeWidth: number
  radius: number
}

export type CurvePoints = [number, number][]

export type Adjustment =
  | { type: 'brightness'; brightness: number; contrast: number }
  | { type: 'levels'; inBlack: number; inWhite: number; gamma: number; outBlack: number; outWhite: number }
  | { type: 'curves'; rgb: CurvePoints; r: CurvePoints; g: CurvePoints; b: CurvePoints }
  | { type: 'hue'; hue: number; saturation: number; lightness: number }
  | { type: 'exposure'; exposure: number; offset: number; gamma: number }
  | { type: 'vibrance'; vibrance: number; saturation: number }
  | { type: 'bw'; reds: number; yellows: number; greens: number; cyans: number; blues: number; magentas: number }
  | { type: 'invert' }

export type AdjustmentType = Adjustment['type']

export interface AdjustLayer extends LayerBase {
  kind: 'adjust'
  adj: Adjustment
}

export type Layer = RasterLayer | TextLayer | ShapeLayer | AdjustLayer

export interface Guides {
  h: number[]
  v: number[]
}

/** Immutable document snapshot. Pixel data lives in Bitmaps. */
export interface Doc {
  width: number
  height: number
  layers: Layer[] // index 0 = bottom
  activeId: string | null
  selection: Bitmap | null
  guides: Guides
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Pt {
  x: number
  y: number
}
