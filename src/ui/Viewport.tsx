import { useEffect, useRef, useState } from 'react'
import { maskOutline } from '../core/selection'
import { S, commit, set, setDocSilent, useStore, type ToolId } from '../core/store'
import { autoFit, fitView, panBy, toDoc, zoomTo } from '../core/view'
import { TOOLS, isToolBusy, setHover, type PInfo } from '../tools/tools'
import { getComposite } from './composite'
import { Rulers, RULER } from './Rulers'
import { TextEditor } from './TextEditor'
import { capture } from './kit'

const BG = '#0d0d0f'

let checker: CanvasPattern | null = null
function checkerPattern(g: CanvasRenderingContext2D, dpr: number) {
  if (checker) return checker
  const s = Math.round(8 * dpr)
  const c = document.createElement('canvas')
  c.width = c.height = s * 2
  const cg = c.getContext('2d')!
  cg.fillStyle = '#ffffff'
  cg.fillRect(0, 0, s * 2, s * 2)
  cg.fillStyle = '#dedede'
  cg.fillRect(0, 0, s, s)
  cg.fillRect(s, s, s, s)
  checker = g.createPattern(c, 'repeat')
  return checker
}

export function Viewport() {
  const wrap = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [cursor, setCursor] = useState('default')
  const rulers = useStore(s => s.rulers)
  const spaceHeld = useRef(false)
  const pan = useRef<{ x: number; y: number } | null>(null)
  const guideDrag = useRef<{ axis: 'h' | 'v'; index: number } | null>(null)
  const tempTool = useRef<ToolId | null>(null)
  const dash = useRef(0)

  // Size tracking
  useEffect(() => {
    const el = canvasRef.current!
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      el.width = Math.round(r.width * dpr)
      el.height = Math.round(r.height * dpr)
      set({ viewport: { w: r.width, h: r.height } })
      if (autoFit && S().doc) fitView()
      draw()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Redraw on any relevant change
  useEffect(() => {
    let raf = 0
    const req = () => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw() })
    }
    const unsub = useStore.subscribe((s, p) => {
      if (s.doc !== p.doc || s.ver !== p.ver || s.preview !== p.preview || s.view !== p.view || s.overlayVer !== p.overlayVer || s.tool !== p.tool || s.showGuides !== p.showGuides) req()
    })
    // Marching ants
    const ants = setInterval(() => {
      if (S().doc?.selection) {
        dash.current = (dash.current + 1) % 8
        req()
      }
    }, 110)
    return () => { unsub(); clearInterval(ants); cancelAnimationFrame(raf) }
  }, [])

  function draw() {
    const c = canvasRef.current
    if (!c) return
    const g = c.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const { doc, view } = S()
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.fillStyle = BG
    g.fillRect(0, 0, c.width, c.height)
    if (!doc) return
    const z = view.zoom * dpr
    const ox = view.panX * dpr, oy = view.panY * dpr
    const dw = doc.width * z, dh = doc.height * z

    // Drop shadow + checkerboard
    g.save()
    g.shadowColor = 'rgba(0,0,0,.55)'
    g.shadowBlur = 24 * dpr
    g.shadowOffsetY = 6 * dpr
    g.fillStyle = '#fff'
    g.fillRect(ox, oy, dw, dh)
    g.restore()
    g.save()
    g.beginPath()
    g.rect(ox, oy, dw, dh)
    g.clip()
    g.fillStyle = checkerPattern(g, dpr) ?? "#fff"
    g.fillRect(ox, oy, dw, dh)

    const comp = getComposite()
    if (comp) {
      g.imageSmoothingEnabled = view.zoom < 2
      g.imageSmoothingQuality = 'high'
      g.setTransform(z, 0, 0, z, ox, oy)
      g.drawImage(comp, 0, 0)
      g.setTransform(1, 0, 0, 1, 0, 0)
    }

    // Pixel grid at high zoom
    if (view.zoom >= 12) {
      g.strokeStyle = 'rgba(128,128,128,.25)'
      g.lineWidth = 1
      g.beginPath()
      const x0 = Math.max(0, Math.floor(-ox / z)), x1 = Math.min(doc.width, Math.ceil((c.width - ox) / z))
      const y0 = Math.max(0, Math.floor(-oy / z)), y1 = Math.min(doc.height, Math.ceil((c.height - oy) / z))
      for (let x = x0; x <= x1; x++) { const sx = Math.round(ox + x * z) + 0.5; g.moveTo(sx, oy + y0 * z); g.lineTo(sx, oy + y1 * z) }
      for (let y = y0; y <= y1; y++) { const sy = Math.round(oy + y * z) + 0.5; g.moveTo(ox + x0 * z, sy); g.lineTo(ox + x1 * z, sy) }
      g.stroke()
    }
    g.restore()

    // Selection
    if (doc.selection) {
      const path = maskOutline(doc.selection)
      g.save()
      g.setTransform(z, 0, 0, z, ox, oy)
      g.lineWidth = 1 / z * dpr
      g.strokeStyle = '#000'
      g.stroke(path)
      g.setLineDash([4 / view.zoom, 4 / view.zoom])
      g.lineDashOffset = -dash.current / view.zoom
      g.strokeStyle = '#fff'
      g.stroke(path)
      g.restore()
    }

    // Guides
    if (S().showGuides) {
      g.strokeStyle = 'rgba(198,255,61,.8)'
      g.lineWidth = dpr
      g.beginPath()
      for (const y of doc.guides.h) { const sy = Math.round(oy + y * z) + 0.5; g.moveTo(0, sy); g.lineTo(c.width, sy) }
      for (const x of doc.guides.v) { const sx = Math.round(ox + x * z) + 0.5; g.moveTo(sx, 0); g.lineTo(sx, c.height) }
      g.stroke()
    }

    const t = TOOLS[tempTool.current ?? S().tool]
    t.overlay?.(g, dpr)
  }

  function info(e: React.PointerEvent | PointerEvent): PInfo {
    const r = canvasRef.current!.getBoundingClientRect()
    const sx = e.clientX - r.left, sy = e.clientY - r.top
    const p = toDoc(sx, sy)
    return {
      x: p.x, y: p.y, sx, sy, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey,
      pressure: e.pressure || 0.5, pen: e.pointerType === 'pen', dbl: e.detail === 2,
    }
  }

  function guideAt(sx: number, sy: number): { axis: 'h' | 'v'; index: number } | null {
    const d = S().doc
    if (!d || !S().showGuides) return null
    const v = S().view
    const hi = d.guides.h.findIndex(y => Math.abs(y * v.zoom + v.panY - sy) < 4)
    if (hi >= 0) return { axis: 'h', index: hi }
    const vi = d.guides.v.findIndex(x => Math.abs(x * v.zoom + v.panX - sx) < 4)
    if (vi >= 0) return { axis: 'v', index: vi }
    return null
  }

  function startGuide(axis: 'h' | 'v', e: React.PointerEvent) {
    const d = S().doc
    if (!d) return
    const p = info(e)
    const guides = { ...d.guides, [axis]: [...d.guides[axis], axis === 'h' ? p.y : p.x] }
    setDocSilent({ ...d, guides })
    guideDrag.current = { axis, index: guides[axis].length - 1 }
    ;capture((e.target as Element), e.pointerId)
  }

  function moveGuide(e: React.PointerEvent) {
    const gd = guideDrag.current
    const d = S().doc
    if (!gd || !d) return
    const p = info(e)
    const arr = [...d.guides[gd.axis]]
    arr[gd.index] = Math.round(gd.axis === 'h' ? p.y : p.x)
    setDocSilent({ ...d, guides: { ...d.guides, [gd.axis]: arr } })
  }

  function endGuide(e: React.PointerEvent) {
    const gd = guideDrag.current
    guideDrag.current = null
    const d = S().doc
    if (!gd || !d) return
    const p = info(e)
    const off = gd.axis === 'h' ? p.sy < 0 || p.y < 0 || p.y > d.height : p.sx < 0 || p.x < 0 || p.x > d.width
    if (off) {
      const arr = d.guides[gd.axis].filter((_, i) => i !== gd.index)
      setDocSilent({ ...d, guides: { ...d.guides, [gd.axis]: arr } })
      commit('Remove guide')
    } else commit('Guide')
  }

  function activeToolId(e?: { altKey: boolean }): ToolId {
    if (tempTool.current) return tempTool.current
    const t = S().tool
    if (e?.altKey && (t === 'brush' || t === 'bucket')) return 'eyedropper'
    return t
  }

  function onDown(e: React.PointerEvent) {
    if (!S().doc) return
    capture(canvasRef.current!, e.pointerId)
    if (e.button === 1 || spaceHeld.current) {
      pan.current = { x: e.clientX, y: e.clientY }
      setCursor('grabbing')
      return
    }
    if (e.button !== 0) return
    const p = info(e)
    if (S().tool === 'move') {
      const gd = guideAt(p.sx, p.sy)
      if (gd) {
        guideDrag.current = gd
        return
      }
    }
    tempTool.current = e.altKey && (S().tool === 'brush' || S().tool === 'bucket') ? 'eyedropper' : null
    TOOLS[activeToolId()].down?.(p)
  }

  function onMove(e: React.PointerEvent) {
    const p = info(e)
    setHover(p)
    if (S().doc) set({ cursor: { x: p.x, y: p.y } })
    if (pan.current) {
      panBy(e.clientX - pan.current.x, e.clientY - pan.current.y)
      pan.current = { x: e.clientX, y: e.clientY }
      return
    }
    if (guideDrag.current) return moveGuide(e)
    const t = TOOLS[activeToolId(e)]
    if (e.buttons & 1) {
      // Coalesced events give smoother brush strokes.
      const evs = (e.nativeEvent.getCoalescedEvents?.() ?? []) as PointerEvent[]
      if (evs.length > 1) for (const ce of evs) t.move?.(info(ce))
      else t.move?.(p)
    } else {
      t.hover?.(p)
      if (S().tool === 'move' && guideAt(p.sx, p.sy)) setCursor(guideAt(p.sx, p.sy)!.axis === 'h' ? 'ns-resize' : 'ew-resize')
      else setCursor(spaceHeld.current ? 'grab' : t.cursor(p))
    }
  }

  function onUp(e: React.PointerEvent) {
    if (pan.current) {
      pan.current = null
      setCursor(spaceHeld.current ? 'grab' : TOOLS[S().tool].cursor(info(e)))
      return
    }
    if (guideDrag.current) return endGuide(e)
    TOOLS[activeToolId()].up?.(info(e))
    tempTool.current = null
  }

  function onLeave() {
    setHover(null)
    set({ cursor: null })
    TOOLS[S().tool].hover?.(null)
  }

  // Wheel: Ctrl/Alt zooms, plain wheel pans.
  useEffect(() => {
    const el = canvasRef.current!
    const wheel = (e: WheelEvent) => {
      if (!S().doc) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      if (e.ctrlKey || e.altKey || e.metaKey) {
        const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018))
        zoomTo(S().view.zoom * f, e.clientX - r.left, e.clientY - r.top)
      } else {
        const k = e.deltaMode === 1 ? 20 : 1
        if (e.shiftKey) panBy(-e.deltaY * k, -e.deltaX * k)
        else panBy(-e.deltaX * k, -e.deltaY * k)
      }
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  // Space = temporary hand
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !(e.target as HTMLElement).closest('input,textarea,select,[contenteditable]') && !S().textEditId) {
        e.preventDefault()
        if (!isToolBusy()) {
          spaceHeld.current = true
          setCursor('grab')
        }
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeld.current = false
        setCursor(TOOLS[S().tool].cursor(null))
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  // Tool switching resets cursor + overlay
  const tool = useStore(s => s.tool)
  useEffect(() => {
    setCursor(TOOLS[tool].cursor(null))
  }, [tool])

  return (
    <div ref={wrap} className="relative min-h-0 min-w-0 flex-1 overflow-hidden" style={{ background: BG }}>
      {rulers && <Rulers onGuideStart={startGuide} onGuideMove={moveGuide} onGuideEnd={endGuide} />}
      <canvas
        ref={canvasRef}
        className="absolute touch-none"
        style={{ left: rulers ? RULER : 0, top: rulers ? RULER : 0, width: `calc(100% - ${rulers ? RULER : 0}px)`, height: `calc(100% - ${rulers ? RULER : 0}px)`, cursor }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={onLeave}
        onContextMenu={e => e.preventDefault()}
      />
      <TextEditor offset={rulers ? RULER : 0} />
    </div>
  )
}
