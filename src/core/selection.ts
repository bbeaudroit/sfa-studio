import { ctx2d, makeCanvas, newBitmap, uid } from './bitmap'
import type { Bitmap, Rect } from './types'

export type SelMode = 'new' | 'add' | 'subtract' | 'intersect'

/** Masks are white pixels; alpha = selection strength. */
export function maskFromPath(w: number, h: number, path: Path2D, feather = 0): Bitmap {
  const b = newBitmap(w, h)
  const g = ctx2d(b.canvas)
  g.fillStyle = '#fff'
  if (feather > 0) {
    const tmp = makeCanvas(w, h)
    const tg = ctx2d(tmp)
    tg.fillStyle = '#fff'
    tg.fill(path, 'evenodd')
    g.filter = `blur(${feather}px)`
    g.drawImage(tmp, 0, 0)
    g.filter = 'none'
  } else {
    g.fill(path, 'evenodd')
  }
  return b
}

export function maskFromBytes(w: number, h: number, bytes: Uint8Array, smooth = false): Bitmap {
  const c = makeCanvas(w, h)
  const g = ctx2d(c)
  const img = g.createImageData(w, h)
  const d = img.data
  for (let i = 0, j = 0; i < bytes.length; i++, j += 4) {
    if (bytes[i]) {
      d[j] = d[j + 1] = d[j + 2] = 255
      d[j + 3] = bytes[i]
    }
  }
  g.putImageData(img, 0, 0)
  if (!smooth) return { id: uid('bmp'), canvas: c }
  const b = newBitmap(w, h)
  const bg = ctx2d(b.canvas)
  bg.filter = 'blur(0.6px)'
  bg.drawImage(c, 0, 0)
  bg.filter = 'none'
  return b
}

export function combineMasks(prev: Bitmap | null, next: Bitmap, mode: SelMode): Bitmap | null {
  if (!prev || mode === 'new') return next
  const { width: w, height: h } = prev.canvas
  const b = newBitmap(w, h)
  const g = ctx2d(b.canvas)
  if (mode === 'add') {
    g.drawImage(prev.canvas, 0, 0)
    g.drawImage(next.canvas, 0, 0)
  } else if (mode === 'subtract') {
    g.drawImage(prev.canvas, 0, 0)
    g.globalCompositeOperation = 'destination-out'
    g.drawImage(next.canvas, 0, 0)
  } else {
    g.drawImage(prev.canvas, 0, 0)
    g.globalCompositeOperation = 'destination-in'
    g.drawImage(next.canvas, 0, 0)
  }
  g.globalCompositeOperation = 'source-over'
  return isEmptyMask(b) ? null : b
}

export function invertMask(m: Bitmap | null, w: number, h: number): Bitmap | null {
  const b = newBitmap(w, h, '#fff')
  if (!m) return null
  const g = ctx2d(b.canvas)
  g.globalCompositeOperation = 'destination-out'
  g.drawImage(m.canvas, 0, 0)
  g.globalCompositeOperation = 'source-over'
  return isEmptyMask(b) ? null : b
}

export function rectMask(w: number, h: number, r: Rect): Bitmap {
  const b = newBitmap(w, h)
  const g = ctx2d(b.canvas)
  g.fillStyle = '#fff'
  g.fillRect(r.x, r.y, r.w, r.h)
  return b
}

function isEmptyMask(b: Bitmap) {
  return maskBounds(b) === null
}

const boundsCache = new WeakMap<Bitmap, Rect | null>()
export function maskBounds(b: Bitmap): Rect | null {
  if (boundsCache.has(b)) return boundsCache.get(b)!
  const { width: w, height: h } = b.canvas
  const d = ctx2d(b.canvas, true).getImageData(0, 0, w, h).data
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    let rowHit = false
    const row = y * w * 4
    for (let x = 0; x < w; x++) {
      if (d[row + x * 4 + 3] > 0) {
        rowHit = true
        if (x < x0) x0 = x
        if (x > x1) x1 = x
      }
    }
    if (rowHit) {
      if (y < y0) y0 = y
      y1 = y
    }
  }
  const r = x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
  boundsCache.set(b, r)
  return r
}

const outlineCache = new WeakMap<Bitmap, Path2D>()

/** Pixel-edge outline of a mask, for marching ants. Runs are merged to keep the path small. */
export function maskOutline(b: Bitmap): Path2D {
  const hit = outlineCache.get(b)
  if (hit) return hit
  const p = new Path2D()
  const r = maskBounds(b)
  if (r) {
    const { width: W } = b.canvas
    const x0 = r.x, y0 = r.y, w = r.w, h = r.h
    const d = ctx2d(b.canvas, true).getImageData(0, 0, b.canvas.width, b.canvas.height).data
    const inside = (x: number, y: number) => x >= x0 && y >= y0 && x < x0 + w && y < y0 + h && d[(y * W + x) * 4 + 3] > 127
    const openV = new Int32Array(w + 1).fill(-1)
    for (let y = y0; y <= y0 + h; y++) {
      // Horizontal edges on line y
      let run = -1
      for (let x = x0; x <= x0 + w; x++) {
        const e = x < x0 + w && inside(x, y - 1) !== inside(x, y)
        if (e && run < 0) run = x
        else if (!e && run >= 0) {
          p.moveTo(run, y)
          p.lineTo(x, y)
          run = -1
        }
      }
      // Vertical edges in row y
      for (let x = x0; x <= x0 + w; x++) {
        const e = y < y0 + h && inside(x - 1, y) !== inside(x, y)
        const k = x - x0
        if (e && openV[k] < 0) openV[k] = y
        else if (!e && openV[k] >= 0) {
          p.moveTo(x, openV[k])
          p.lineTo(x, y)
          openV[k] = -1
        }
      }
    }
  }
  outlineCache.set(b, p)
  return p
}

/** Returns a copy of `src` keeping only pixels inside the mask. Mask is doc-space; src sits at (ox, oy). */
export function clipToMask(src: HTMLCanvasElement, mask: Bitmap, ox: number, oy: number): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height)
  const g = ctx2d(c)
  g.drawImage(src, 0, 0)
  g.globalCompositeOperation = 'destination-in'
  g.drawImage(mask.canvas, -ox, -oy)
  g.globalCompositeOperation = 'source-over'
  return c
}

/**
 * Flood-select pixels similar to the one at (sx, sy).
 * Returns per-pixel 0/255 bytes.
 */
export function floodMask(img: ImageData, sx: number, sy: number, tolerance: number, contiguous: boolean): Uint8Array {
  const { width: w, height: h, data: d } = img
  const out = new Uint8Array(w * h)
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out
  const si = (sy * w + sx) * 4
  const r0 = d[si], g0 = d[si + 1], b0 = d[si + 2], a0 = d[si + 3]
  const tol = tolerance
  const match = (i: number) => {
    const j = i * 4
    // Fully transparent pixels match each other regardless of their (meaningless) RGB.
    if (a0 === 0 && d[j + 3] === 0) return true
    return (
      Math.abs(d[j] - r0) <= tol && Math.abs(d[j + 1] - g0) <= tol &&
      Math.abs(d[j + 2] - b0) <= tol && Math.abs(d[j + 3] - a0) <= tol
    )
  }
  if (!contiguous) {
    for (let i = 0; i < w * h; i++) if (match(i)) out[i] = 255
    return out
  }
  const stack: number[] = [sx, sy]
  while (stack.length) {
    const y = stack.pop()!
    let x = stack.pop()!
    let i = y * w + x
    while (x >= 0 && !out[i] && match(i)) { x--; i-- }
    x++; i++
    let up = false, down = false
    while (x < w && !out[i] && match(i)) {
      out[i] = 255
      if (y > 0) {
        const m = !out[i - w] && match(i - w)
        if (m && !up) { stack.push(x, y - 1); up = true } else if (!m) up = false
      }
      if (y < h - 1) {
        const m = !out[i + w] && match(i + w)
        if (m && !down) { stack.push(x, y + 1); down = true } else if (!m) down = false
      }
      x++; i++
    }
  }
  return out
}
