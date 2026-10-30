import type { Adjustment, AdjustmentType, CurvePoints } from './types'

export const ADJUSTMENTS: { type: AdjustmentType; label: string; key?: string }[] = [
  { type: 'brightness', label: 'Brightness / Contrast' },
  { type: 'levels', label: 'Levels', key: 'Ctrl+L' },
  { type: 'curves', label: 'Curves', key: 'Ctrl+M' },
  { type: 'exposure', label: 'Exposure' },
  { type: 'vibrance', label: 'Vibrance' },
  { type: 'hue', label: 'Hue / Saturation', key: 'Ctrl+U' },
  { type: 'bw', label: 'Black & White', key: 'Ctrl+Alt+Shift+B' },
  { type: 'invert', label: 'Invert', key: 'Ctrl+I' },
]

export function adjustmentLabel(t: AdjustmentType) {
  return ADJUSTMENTS.find(a => a.type === t)!.label
}

const line = (): CurvePoints => [[0, 0], [255, 255]]

export function defaultAdjustment(t: AdjustmentType): Adjustment {
  switch (t) {
    case 'brightness': return { type: t, brightness: 0, contrast: 0 }
    case 'levels': return { type: t, inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 }
    case 'curves': return { type: t, rgb: line(), r: line(), g: line(), b: line() }
    case 'hue': return { type: t, hue: 0, saturation: 0, lightness: 0 }
    case 'exposure': return { type: t, exposure: 0, offset: 0, gamma: 1 }
    case 'vibrance': return { type: t, vibrance: 0, saturation: 0 }
    case 'bw': return { type: t, reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 }
    case 'invert': return { type: t }
  }
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

/** Monotone cubic (Fritsch–Carlson) curve through points, sampled to a 256 LUT. */
export function curveLut(points: CurvePoints): Float32Array {
  const p = [...points].sort((a, b) => a[0] - b[0])
  const lut = new Float32Array(256)
  const n = p.length
  if (n < 2) {
    for (let i = 0; i < 256; i++) lut[i] = i
    return lut
  }
  const dx: number[] = [], m: number[] = [], t: number[] = new Array(n)
  for (let i = 0; i < n - 1; i++) {
    dx[i] = p[i + 1][0] - p[i][0] || 1e-6
    m[i] = (p[i + 1][1] - p[i][1]) / dx[i]
  }
  t[0] = m[0]
  t[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i] }
  }
  let seg = 0
  for (let x = 0; x < 256; x++) {
    if (x <= p[0][0]) { lut[x] = p[0][1]; continue }
    if (x >= p[n - 1][0]) { lut[x] = p[n - 1][1]; continue }
    while (seg < n - 2 && x > p[seg + 1][0]) seg++
    const h = dx[seg], u = (x - p[seg][0]) / h
    const u2 = u * u, u3 = u2 * u
    lut[x] = clamp255(
      (2 * u3 - 3 * u2 + 1) * p[seg][1] + (u3 - 2 * u2 + u) * h * t[seg] +
      (-2 * u3 + 3 * u2) * p[seg + 1][1] + (u3 - u2) * h * t[seg + 1],
    )
  }
  return lut
}

const srgbToLin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const linToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)

/** Per-channel LUTs [r, g, b] for adjustments that are pure channel maps, else null. */
function channelLuts(a: Adjustment): [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>] | null {
  const lut = new Float32Array(256)
  switch (a.type) {
    case 'invert':
      for (let i = 0; i < 256; i++) lut[i] = 255 - i
      return [lut, lut, lut]
    case 'brightness': {
      const c = a.contrast * 2.55
      const f = (259 * (c + 255)) / (255 * (259 - c))
      for (let i = 0; i < 256; i++) {
        // Brightness as a midtone-weighted lift so whites/blacks don't clip as hard.
        let v = i / 255
        const b = a.brightness / 100
        v = b >= 0 ? v + b * (1 - v) * 0.8 * (0.5 + v) : v + b * v * 0.8 * (1.5 - v)
        lut[i] = clamp255(f * (v * 255 - 128) + 128)
      }
      return [lut, lut, lut]
    }
    case 'levels': {
      const range = Math.max(1, a.inWhite - a.inBlack)
      for (let i = 0; i < 256; i++) {
        let v = Math.min(1, Math.max(0, (i - a.inBlack) / range))
        v = v ** (1 / Math.max(0.01, a.gamma))
        lut[i] = a.outBlack + v * (a.outWhite - a.outBlack)
      }
      return [lut, lut, lut]
    }
    case 'exposure':
      for (let i = 0; i < 256; i++) {
        let v = srgbToLin(i / 255) * 2 ** a.exposure + a.offset
        v = Math.max(0, v) ** (1 / Math.max(0.01, a.gamma))
        lut[i] = clamp255(linToSrgb(v) * 255)
      }
      return [lut, lut, lut]
    case 'curves': {
      const m = curveLut(a.rgb)
      const r = curveLut(a.r), g = curveLut(a.g), b = curveLut(a.b)
      const mr = new Float32Array(256), mg = new Float32Array(256), mb = new Float32Array(256)
      for (let i = 0; i < 256; i++) {
        mr[i] = r[Math.round(m[i])]
        mg[i] = g[Math.round(m[i])]
        mb[i] = b[Math.round(m[i])]
      }
      return [mr, mg, mb]
    }
    default:
      return null
  }
}

function rgb2hsl(r: number, g: number, b: number, out: number[]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0
  const d = max - min
  if (d > 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  out[0] = h; out[1] = s; out[2] = l
}

function hue2rgb(p: number, q: number, t: number) {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

function hsl2rgb(h: number, s: number, l: number, out: number[]) {
  if (s === 0) { out[0] = out[1] = out[2] = l; return }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  out[0] = hue2rgb(p, q, h + 1 / 3)
  out[1] = hue2rgb(p, q, h)
  out[2] = hue2rgb(p, q, h - 1 / 3)
}

/** Applies an adjustment in place. `amount` (0..1) blends with the original. */
export function applyAdjustment(data: Uint8ClampedArray, a: Adjustment, amount = 1) {
  const n = data.length
  const luts = channelLuts(a)
  if (luts) {
    const [lr, lg, lb] = luts
    const R = new Uint8ClampedArray(256), G = new Uint8ClampedArray(256), B = new Uint8ClampedArray(256)
    for (let i = 0; i < 256; i++) {
      R[i] = i + (lr[i] - i) * amount
      G[i] = i + (lg[i] - i) * amount
      B[i] = i + (lb[i] - i) * amount
    }
    for (let i = 0; i < n; i += 4) {
      if (data[i + 3] === 0) continue
      data[i] = R[data[i]]
      data[i + 1] = G[data[i + 1]]
      data[i + 2] = B[data[i + 2]]
    }
    return
  }
  const hsl = [0, 0, 0], rgb = [0, 0, 0]
  if (a.type === 'hue') {
    const dh = a.hue / 360, ds = a.saturation / 100, dl = a.lightness / 100
    for (let i = 0; i < n; i += 4) {
      if (data[i + 3] === 0) continue
      const r = data[i], g = data[i + 1], b = data[i + 2]
      rgb2hsl(r / 255, g / 255, b / 255, hsl)
      let h = hsl[0] + dh, s = hsl[1], l = hsl[2]
      h -= Math.floor(h)
      s = ds >= 0 ? s + (1 - s) * ds * s : s * (1 + ds)
      l = dl >= 0 ? l + (1 - l) * dl : l * (1 + dl)
      hsl2rgb(h, Math.min(1, Math.max(0, s)), l, rgb)
      data[i] = r + (rgb[0] * 255 - r) * amount
      data[i + 1] = g + (rgb[1] * 255 - g) * amount
      data[i + 2] = b + (rgb[2] * 255 - b) * amount
    }
  } else if (a.type === 'vibrance') {
    const v = a.vibrance / 100, sat = 1 + a.saturation / 100
    for (let i = 0; i < n; i += 4) {
      if (data[i + 3] === 0) continue
      const r0 = data[i], g0 = data[i + 1], b0 = data[i + 2]
      let r = r0, g = g0, b = b0
      const mx = Math.max(r, g, b), avg = (r + g + b) / 3
      // Vibrance boosts muted pixels more than already-saturated ones.
      const k = v * (1 - (Math.abs(mx - avg) * 2) / 255) * 1.2
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      const f = (1 + k) * sat
      r = lum + (r - lum) * f
      g = lum + (g - lum) * f
      b = lum + (b - lum) * f
      data[i] = r0 + (r - r0) * amount
      data[i + 1] = g0 + (g - g0) * amount
      data[i + 2] = b0 + (b - b0) * amount
    }
  } else if (a.type === 'bw') {
    const w = { r: a.reds / 100, y: a.yellows / 100, g: a.greens / 100, c: a.cyans / 100, b: a.blues / 100, m: a.magentas / 100 }
    for (let i = 0; i < n; i += 4) {
      if (data[i + 3] === 0) continue
      const r = data[i], g = data[i + 1], b = data[i + 2]
      let mn: number, md: number, mx: number, wp: number, ws: number
      if (r >= g && r >= b) {
        mx = r; wp = w.r
        if (g >= b) { md = g; mn = b; ws = w.y } else { md = b; mn = g; ws = w.m }
      } else if (g >= r && g >= b) {
        mx = g; wp = w.g
        if (r >= b) { md = r; mn = b; ws = w.y } else { md = b; mn = r; ws = w.c }
      } else {
        mx = b; wp = w.b
        if (r >= g) { md = r; mn = g; ws = w.m } else { md = g; mn = r; ws = w.c }
      }
      const gray = clamp255(mn + (md - mn) * ws + (mx - md) * wp)
      data[i] = r + (gray - r) * amount
      data[i + 1] = g + (gray - g) * amount
      data[i + 2] = b + (gray - b) * amount
    }
  }
}

export function histogram(data: Uint8ClampedArray): { r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array } {
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256)
  for (let i = 0; i < data.length; i += 16) {
    if (data[i + 3] === 0) continue
    r[data[i]]++
    g[data[i + 1]]++
    b[data[i + 2]]++
    l[(data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8]++
  }
  return { r, g, b, l }
}
