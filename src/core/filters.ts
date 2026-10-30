import { ctx2d, makeCanvas } from './bitmap'

/** Gaussian blur with edges extended, so opaque images don't fade at the border. */
export function gaussianBlur(src: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const { width: w, height: h } = src
  const out = makeCanvas(w, h)
  if (radius <= 0) {
    ctx2d(out).drawImage(src, 0, 0)
    return out
  }
  const og = ctx2d(out)
  if (hasTransparency(src)) {
    og.filter = `blur(${radius}px)`
    og.drawImage(src, 0, 0)
    og.filter = 'none'
    return out
  }
  const p = Math.ceil(radius * 3)
  const pad = makeCanvas(w + p * 2, h + p * 2)
  const g = ctx2d(pad)
  g.drawImage(src, p, p)
  g.drawImage(src, 0, 0, 1, h, 0, p, p, h)
  g.drawImage(src, w - 1, 0, 1, h, w + p, p, p, h)
  g.drawImage(src, 0, 0, w, 1, p, 0, w, p)
  g.drawImage(src, 0, h - 1, w, 1, p, h + p, w, p)
  g.drawImage(src, 0, 0, 1, 1, 0, 0, p, p)
  g.drawImage(src, w - 1, 0, 1, 1, w + p, 0, p, p)
  g.drawImage(src, 0, h - 1, 1, 1, 0, h + p, p, p)
  g.drawImage(src, w - 1, h - 1, 1, 1, w + p, h + p, p, p)
  og.filter = `blur(${radius}px)`
  og.drawImage(pad, -p, -p)
  og.filter = 'none'
  return out
}

function hasTransparency(c: HTMLCanvasElement) {
  const d = ctx2d(c, true).getImageData(0, 0, c.width, c.height).data
  for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 255) return true
  return false
}

/** Unsharp mask: original + amount × (original − blurred), with a threshold. */
export function unsharp(src: HTMLCanvasElement, amount: number, radius: number, threshold: number): HTMLCanvasElement {
  const { width: w, height: h } = src
  const blurred = gaussianBlur(src, radius)
  const o = ctx2d(src, true).getImageData(0, 0, w, h)
  const b = ctx2d(blurred, true).getImageData(0, 0, w, h).data
  const d = o.data
  const k = amount / 100
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = d[i + c] - b[i + c]
      if (Math.abs(diff) >= threshold) d[i + c] = d[i + c] + diff * k
    }
  }
  const out = makeCanvas(w, h)
  ctx2d(out).putImageData(o, 0, 0)
  return out
}

export function addNoise(src: HTMLCanvasElement, amount: number, mono: boolean): HTMLCanvasElement {
  const { width: w, height: h } = src
  const o = ctx2d(src, true).getImageData(0, 0, w, h)
  const d = o.data
  const a = amount * 2.55
  let seed = 1337
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296 - 0.5
  }
  for (let i = 0; i < d.length; i += 4) {
    if (mono) {
      const n = rnd() * a
      d[i] += n; d[i + 1] += n; d[i + 2] += n
    } else {
      d[i] += rnd() * a; d[i + 1] += rnd() * a; d[i + 2] += rnd() * a
    }
  }
  const out = makeCanvas(w, h)
  ctx2d(out).putImageData(o, 0, 0)
  return out
}
