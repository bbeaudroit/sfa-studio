import { defaultAdjustment } from './core/adjustments'
import { ctx2d, newBitmap, uid } from './core/bitmap'
import { rasterLayer } from './core/ops'
import { maskFromPath } from './core/selection'
import { commit, loadDoc, set, setDocSilent, S } from './core/store'
import type { AdjustLayer, Doc, ShapeLayer, TextLayer } from './core/types'
import { fitView } from './core/view'

/** A procedural scene used for screenshots and quick testing (open with #demo). */
export function loadDemo(variant = '') {
  const W = 1600, H = 1000
  const sky = newBitmap(W, H)
  let g = ctx2d(sky.canvas)
  const gr = g.createLinearGradient(0, 0, 0, H)
  gr.addColorStop(0, '#1b2a6b')
  gr.addColorStop(0.45, '#c2537a')
  gr.addColorStop(0.75, '#ffb36b')
  gr.addColorStop(1, '#ffe3a3')
  g.fillStyle = gr
  g.fillRect(0, 0, W, H)
  const glow = g.createRadialGradient(1080, 600, 0, 1080, 600, 520)
  glow.addColorStop(0, 'rgba(255,240,200,.85)')
  glow.addColorStop(1, 'rgba(255,240,200,0)')
  g.fillStyle = glow
  g.fillRect(0, 0, W, H)

  const hills = newBitmap(W, H)
  g = ctx2d(hills.canvas)
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const ranges = [
    { y: 640, amp: 120, color: '#7a3f6e' },
    { y: 720, amp: 90, color: '#4b2a5c' },
    { y: 820, amp: 70, color: '#26183a' },
    { y: 900, amp: 40, color: '#120c1e' },
  ]
  for (const r of ranges) {
    g.beginPath()
    g.moveTo(0, H)
    let y = r.y
    for (let x = 0; x <= W; x += 20) {
      y += (rnd() - 0.5) * r.amp * 0.35
      y = Math.max(r.y - r.amp, Math.min(r.y + r.amp * 0.4, y))
      g.lineTo(x, y)
    }
    g.lineTo(W, H)
    g.closePath()
    g.fillStyle = r.color
    g.fill()
  }

  const base = { visible: true, locked: false, opacity: 1, blend: 'source-over' as const }
  const sun: ShapeLayer = { ...base, id: uid('layer'), name: 'Sun', kind: 'shape', shape: 'ellipse', x: 990, y: 470, w: 180, h: 180, fill: '#fff1c7', stroke: null, strokeWidth: 4, radius: 0, blend: 'screen' }
  const title: TextLayer = { ...base, id: uid('layer'), name: 'Golden hour', kind: 'text', x: 120, y: 150, text: 'Golden hour', font: 'Geist Variable', size: 132, weight: 700, italic: false, color: '#ffffff', align: 'left', lineHeight: 1.1 }
  const sub: TextLayer = { ...title, id: uid('layer'), name: 'Caption', y: 310, text: 'Shot 06 — Ridge line, 7:42 pm', size: 34, weight: 400, color: '#ffe9c9', opacity: 0.85 }
  const frame: ShapeLayer = { ...sun, id: uid('layer'), name: 'Frame', shape: 'rect', x: 60, y: 60, w: W - 120, h: H - 120, fill: null, stroke: '#ffffff', strokeWidth: 3, radius: 28, blend: 'source-over', opacity: 0.5 }
  const curves: AdjustLayer = { ...base, id: uid('layer'), name: 'Curves', kind: 'adjust', adj: { ...(defaultAdjustment('curves') as Extract<AdjustLayer['adj'], { type: 'curves' }>), rgb: [[0, 0], [64, 52], [190, 205], [255, 255]] } }
  const vib: AdjustLayer = { ...base, id: uid('layer'), name: 'Vibrance', kind: 'adjust', adj: { type: 'vibrance', vibrance: 35, saturation: 0 } }
  const bgLayer = { ...rasterLayer('Sky', sky), locked: true }
  const hillLayer = rasterLayer('Ridges', hills)
  const doc: Doc = {
    width: W, height: H,
    layers: [bgLayer, sun, hillLayer, curves, vib, frame, sub, title],
    activeId: variant === 'curves' ? curves.id : hillLayer.id,
    selection: null,
    guides: { h: [150], v: [120] },
  }
  loadDoc(doc, 'golden-hour.sfas', null, 'Open')
  commit('Ridges')
  commit('Sun')
  commit('Golden hour')
  commit('Curves')
  fitView()
  if (variant === 'sel') {
    const p = new Path2D()
    p.ellipse(1080, 560, 260, 200, 0, 0, Math.PI * 2)
    setDocSilent({ ...S().doc!, selection: maskFromPath(W, H, p) })
    commit('Elliptical marquee')
    set({ tool: 'marquee' })
  }
  if (variant === 'fx') {
    const d = S().doc!
    // Mask the ridges with a soft vertical fade and give the title effects.
    const m = newBitmap(W, H)
    const mg = ctx2d(m.canvas)
    const fade = mg.createLinearGradient(0, 560, 0, 760)
    fade.addColorStop(0, '#000')
    fade.addColorStop(1, '#fff')
    mg.fillStyle = fade
    mg.fillRect(0, 0, W, H)
    setDocSilent({
      ...d,
      activeId: title.id,
      layers: d.layers.map(l =>
        l.id === hillLayer.id ? { ...l, mask: { bmp: m, x: 0, y: 0, enabled: true } }
          : l.id === title.id ? { ...l, fx: { shadow: { on: true, color: '#1b0f2e', opacity: 0.7, angle: 120, distance: 10, size: 24 }, stroke: { on: true, color: '#C6FF3D', opacity: 1, size: 3 } } }
            : l),
    })
    commit('Layer style')
    set({ tool: 'move' })
  }
  if (variant === 'brush') set({ tool: 'brush' })
  if (variant === 'curves') set({ tool: 'move' })
  try { localStorage.setItem('sfa.studio.hint.v1', '1') } catch { /* ignore */ }
}
