import { Maximize, Minus, Plus } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { S, useStore } from '../../core/store'
import { centerOn, fitView, zoomStep, zoomTo } from '../../core/view'
import { getComposite } from '../composite'
import { IconBtn, capture } from '../kit'

const H = 132

export function Navigator() {
  const ref = useRef<HTMLCanvasElement>(null)
  const zoom = useStore(s => s.view.zoom)
  const hasDoc = useStore(s => !!s.doc)

  useEffect(() => {
    let t = 0, raf = 0
    const draw = () => {
      raf = 0
      const c = ref.current
      const { doc, view, viewport } = S()
      if (!c || !doc) return
      const dpr = window.devicePixelRatio || 1
      const r = c.getBoundingClientRect()
      c.width = Math.round(r.width * dpr)
      c.height = Math.round(r.height * dpr)
      const g = c.getContext('2d')!
      const k = Math.min((c.width - 16 * dpr) / doc.width, (c.height - 16 * dpr) / doc.height)
      const w = doc.width * k, h = doc.height * k
      const ox = (c.width - w) / 2, oy = (c.height - h) / 2
      g.clearRect(0, 0, c.width, c.height)
      g.fillStyle = '#fff'
      g.fillRect(ox, oy, w, h)
      const comp = getComposite()
      if (comp) {
        g.imageSmoothingQuality = 'high'
        g.drawImage(comp, ox, oy, w, h)
      }
      // Visible area
      const vx = ox + (-view.panX / view.zoom) * k, vy = oy + (-view.panY / view.zoom) * k
      const vw = (viewport.w / view.zoom) * k, vh = (viewport.h / view.zoom) * k
      g.save()
      g.beginPath()
      g.rect(0, 0, c.width, c.height)
      g.rect(vx, vy, vw, vh)
      g.fillStyle = 'rgba(7,7,8,.55)'
      g.fill('evenodd')
      g.restore()
      g.strokeStyle = '#C6FF3D'
      g.lineWidth = 1.5 * dpr
      g.strokeRect(vx, vy, vw, vh)
      ;(c as HTMLCanvasElement & { _map?: object })._map = { ox: ox / dpr, oy: oy / dpr, k: k / dpr }
    }
    const req = () => {
      clearTimeout(t)
      t = window.setTimeout(() => { if (!raf) raf = requestAnimationFrame(draw) }, 30)
    }
    req()
    const unsub = useStore.subscribe((s, p) => {
      if (s.doc !== p.doc || s.ver !== p.ver || s.view !== p.view || s.viewport !== p.viewport || (s.preview !== p.preview && !s.preview)) req()
    })
    return () => { unsub(); clearTimeout(t); cancelAnimationFrame(raf) }
  }, [hasDoc])

  const panTo = (e: React.PointerEvent) => {
    const c = ref.current as HTMLCanvasElement & { _map?: { ox: number; oy: number; k: number } }
    if (!c._map) return
    const r = c.getBoundingClientRect()
    const { ox, oy, k } = c._map
    centerOn((e.clientX - r.left - ox) / k, (e.clientY - r.top - oy) / k)
  }

  return (
    <div className="px-3 pb-3">
      <canvas
        ref={ref}
        className="w-full cursor-move touch-none rounded-lg bg-ink-950"
        style={{ height: H }}
        onPointerDown={e => { capture((e.target as Element), e.pointerId); panTo(e) }}
        onPointerMove={e => e.buttons & 1 && panTo(e)}
      />
      <div className="mt-2 flex items-center gap-1">
        <IconBtn icon={<Minus size={14} />} tip="Zoom out" k="Ctrl+-" onClick={() => zoomStep(-1)} size="sm" disabled={!hasDoc} />
        <input
          type="range"
          className="slider flex-1"
          min={-4.6}
          max={3.4}
          step={0.01}
          value={Math.log(zoom)}
          style={{ '--p': `${((Math.log(zoom) + 4.6) / 8) * 100}%` } as React.CSSProperties}
          onChange={e => zoomTo(Math.exp(Number(e.target.value)))}
          disabled={!hasDoc}
          aria-label="Zoom"
        />
        <IconBtn icon={<Plus size={14} />} tip="Zoom in" k="Ctrl+=" onClick={() => zoomStep(1)} size="sm" disabled={!hasDoc} />
        <span className="w-11 text-right font-mono text-[11px] text-ink-300">{Math.round(zoom * 100)}%</span>
        <IconBtn icon={<Maximize size={13} />} tip="Fit" k="Ctrl+0" onClick={() => fitView()} size="sm" disabled={!hasDoc} />
      </div>
    </div>
  )
}
