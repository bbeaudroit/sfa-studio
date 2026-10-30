import { useEffect, useRef } from 'react'
import { S, useStore } from '../core/store'

export const RULER = 20

const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000]

interface Props {
  onGuideStart: (axis: 'h' | 'v', e: React.PointerEvent) => void
  onGuideMove: (e: React.PointerEvent) => void
  onGuideEnd: (e: React.PointerEvent) => void
}

export function Rulers({ onGuideStart, onGuideMove, onGuideEnd }: Props) {
  const top = useRef<HTMLCanvasElement>(null)
  const left = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let raf = 0
    const draw = () => {
      raf = 0
      const { view, doc, cursor } = S()
      const dpr = window.devicePixelRatio || 1
      for (const [c, axis] of [[top.current, 'x'], [left.current, 'y']] as const) {
        if (!c) continue
        const r = c.getBoundingClientRect()
        const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr)
        if (c.width !== W || c.height !== H) { c.width = W; c.height = H }
        const g = c.getContext('2d')!
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.fillStyle = '#111113'
        g.fillRect(0, 0, W, H)
        g.fillStyle = '#26262a'
        if (axis === 'x') g.fillRect(0, H - dpr, W, dpr)
        else g.fillRect(W - dpr, 0, dpr, H)
        if (!doc) continue
        const z = view.zoom
        const step = STEPS.find(s => s * z >= 56) ?? 10000
        const minor = step / (step % 5 === 0 ? 5 : step % 2 === 0 ? 2 : 1)
        const pan = axis === 'x' ? view.panX : view.panY
        const len = axis === 'x' ? r.width : r.height
        const start = Math.floor(-pan / z / minor) * minor
        const end = (len - pan) / z
        // Highlight document extent
        const d0 = Math.max(0, pan) * dpr, d1 = Math.min(len, pan + (axis === 'x' ? doc.width : doc.height) * z) * dpr
        g.fillStyle = 'rgba(255,255,255,.035)'
        if (axis === 'x') g.fillRect(d0, 0, d1 - d0, H)
        else g.fillRect(0, d0, W, d1 - d0)
        g.strokeStyle = '#3a3a40'
        g.fillStyle = '#7c7c85'
        g.font = `${9 * dpr}px "Geist Mono Variable", monospace`
        g.lineWidth = dpr
        g.beginPath()
        for (let v = start; v <= end; v += minor) {
          const s = Math.round((pan + v * z) * dpr) + 0.5
          const major = Math.abs(v / step - Math.round(v / step)) < 1e-6
          const tick = major ? RULER * dpr : RULER * dpr * 0.3
          if (axis === 'x') { g.moveTo(s, H); g.lineTo(s, H - tick) }
          else { g.moveTo(W, s); g.lineTo(W - tick, s) }
          if (major) {
            const label = String(Math.round(v))
            if (axis === 'x') g.fillText(label, s + 3 * dpr, 9 * dpr)
            else {
              g.save()
              g.translate(9 * dpr, s + 3 * dpr)
              g.rotate(-Math.PI / 2)
              g.textAlign = 'right'
              g.fillText(label, 0, 0)
              g.restore()
            }
          }
        }
        g.stroke()
        if (cursor) {
          const s = (pan + (axis === 'x' ? cursor.x : cursor.y) * z) * dpr
          g.fillStyle = '#C6FF3D'
          if (axis === 'x') g.fillRect(s, 0, dpr, H)
          else g.fillRect(0, s, W, dpr)
        }
      }
    }
    const req = () => { if (!raf) raf = requestAnimationFrame(draw) }
    req()
    const unsub = useStore.subscribe((s, p) => { if (s.view !== p.view || s.doc !== p.doc || s.cursor !== p.cursor || s.viewport !== p.viewport) req() })
    const ro = new ResizeObserver(req)
    if (top.current) ro.observe(top.current)
    return () => { unsub(); ro.disconnect(); cancelAnimationFrame(raf) }
  }, [])

  const handlers = (axis: 'h' | 'v') => ({
    onPointerDown: (e: React.PointerEvent) => e.button === 0 && onGuideStart(axis, e),
    onPointerMove: onGuideMove,
    onPointerUp: onGuideEnd,
  })

  return (
    <>
      <div className="absolute top-0 left-0 z-10 border-r border-b border-ink-600 bg-ink-850" style={{ width: RULER, height: RULER }} />
      <canvas ref={top} data-tip="Drag down to add a guide" className="absolute top-0 cursor-ns-resize touch-none" style={{ left: RULER, height: RULER, width: `calc(100% - ${RULER}px)` }} {...handlers('h')} />
      <canvas ref={left} data-tip="Drag right to add a guide" data-side="right" className="absolute left-0 cursor-ew-resize touch-none" style={{ top: RULER, width: RULER, height: `calc(100% - ${RULER}px)` }} {...handlers('v')} />
    </>
  )
}
