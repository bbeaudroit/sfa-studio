import { S, set } from './store'

export const ZOOM_STEPS = [0.02, 0.03, 0.05, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 1.5, 2, 3, 4, 5, 6, 8, 12, 16, 24, 32]

/** True while the view should keep fitting the window (until the user zooms/pans). */
export let autoFit = false

export function fitView(pad = 48) {
  const { doc, viewport } = S()
  if (!doc) return
  autoFit = true
  const z = Math.min((viewport.w - pad * 2) / doc.width, (viewport.h - pad * 2) / doc.height, 1)
  const zoom = Math.max(0.01, z)
  set({ view: { zoom, panX: Math.round((viewport.w - doc.width * zoom) / 2), panY: Math.round((viewport.h - doc.height * zoom) / 2) } })
}

export function fillView() {
  autoFit = false
  const { doc, viewport } = S()
  if (!doc) return
  const zoom = Math.max(viewport.w / doc.width, viewport.h / doc.height)
  set({ view: { zoom, panX: (viewport.w - doc.width * zoom) / 2, panY: (viewport.h - doc.height * zoom) / 2 } })
}

/** Zoom keeping the screen point (sx, sy) fixed. */
export function zoomTo(zoom: number, sx?: number, sy?: number) {
  autoFit = false
  const { view, viewport } = S()
  const z = Math.min(64, Math.max(0.01, zoom))
  const cx = sx ?? viewport.w / 2, cy = sy ?? viewport.h / 2
  const dx = (cx - view.panX) / view.zoom, dy = (cy - view.panY) / view.zoom
  set({ view: { zoom: z, panX: cx - dx * z, panY: cy - dy * z } })
}

export function zoomStep(dir: 1 | -1, sx?: number, sy?: number) {
  const z = S().view.zoom
  const next = dir > 0 ? ZOOM_STEPS.find(s => s > z * 1.001) ?? z * 1.5 : [...ZOOM_STEPS].reverse().find(s => s < z / 1.001) ?? z / 1.5
  zoomTo(next, sx, sy)
}

export function actualPixels() {
  autoFit = false
  const { doc, viewport } = S()
  if (!doc) return
  set({ view: { zoom: 1, panX: Math.round((viewport.w - doc.width) / 2), panY: Math.round((viewport.h - doc.height) / 2) } })
}

export function panBy(dx: number, dy: number) {
  autoFit = false
  const v = S().view
  set({ view: { ...v, panX: v.panX + dx, panY: v.panY + dy } })
}

export function centerOn(x: number, y: number) {
  autoFit = false
  const { view, viewport } = S()
  set({ view: { ...view, panX: viewport.w / 2 - x * view.zoom, panY: viewport.h / 2 - y * view.zoom } })
}

export function toDoc(sx: number, sy: number) {
  const v = S().view
  return { x: (sx - v.panX) / v.zoom, y: (sy - v.panY) / v.zoom }
}

export function toScreen(x: number, y: number) {
  const v = S().view
  return { x: x * v.zoom + v.panX, y: y * v.zoom + v.panY }
}
