import type { Bitmap, Rect } from './types'

let seq = 0
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

export function ctx2d(c: HTMLCanvasElement, read = false): CanvasRenderingContext2D {
  return c.getContext('2d', read ? { willReadFrequently: true } : undefined)!
}

export function newBitmap(w: number, h: number, fill?: string): Bitmap {
  const canvas = makeCanvas(w, h)
  if (fill) {
    const g = ctx2d(canvas)
    g.fillStyle = fill
    g.fillRect(0, 0, w, h)
  }
  return { id: uid('bmp'), canvas }
}

export function bitmapFrom(src: CanvasImageSource, w: number, h: number): Bitmap {
  const b = newBitmap(w, h)
  ctx2d(b.canvas).drawImage(src, 0, 0)
  return b
}

export function cloneBitmap(b: Bitmap): Bitmap {
  return bitmapFrom(b.canvas, b.canvas.width, b.canvas.height)
}

export function clampRect(r: Rect, w: number, h: number): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x))
  const y0 = Math.max(0, Math.floor(r.y))
  const x1 = Math.min(w, Math.ceil(r.x + r.w))
  const y1 = Math.min(h, Math.ceil(r.y + r.h))
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b }
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

/** Bounding box of non-transparent pixels, or null if empty. */
export function alphaBounds(c: HTMLCanvasElement): Rect | null {
  const { width: w, height: h } = c
  const d = ctx2d(c, true).getImageData(0, 0, w, h).data
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    const row = y * w * 4
    for (let x = 0; x < w; x++) {
      if (d[row + x * 4 + 3] > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

export async function loadImage(src: Blob | string): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof src !== 'string') {
    try {
      return await createImageBitmap(src, { imageOrientation: 'from-image' })
    } catch { /* fall back to <img> (e.g. SVG) */ }
  }
  const url = typeof src === 'string' ? src : URL.createObjectURL(src)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return img
  } finally {
    if (typeof src !== 'string') setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Encode failed'))), type, quality))
}
