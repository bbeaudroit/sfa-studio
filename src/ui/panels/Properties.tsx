import { AlignCenter, AlignLeft, AlignRight, FlipHorizontal2, FlipVertical2, Italic, RotateCcw } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { adjustmentLabel, curveLut, defaultAdjustment, histogram } from '../../core/adjustments'
import { ctx2d, makeCanvas } from '../../core/bitmap'
import { flipLayer, rasterize } from '../../core/ops'
import { compositeLayers } from '../../core/render'
import { S, commit, set, useStore } from '../../core/store'
import type { RasterLayer, AdjustLayer, Adjustment, CurvePoints, Doc, Layer, ShapeLayer, TextLayer } from '../../core/types'
import { ColorSwatch } from '../ColorPicker'
import { useFonts } from '../fonts'
import { Btn, Check, IconBtn, NumField, Segmented, Select, Slider, cx, capture } from '../kit'

/** Silent live edits to one layer, committed as one history step. */
function useLive(id: string) {
  return useMemo(() => ({
    change(patch: Partial<Layer>) {
      const d = S().doc
      if (!d) return
      set({ doc: { ...d, layers: d.layers.map(l => (l.id === id ? ({ ...l, ...patch } as Layer) : l)) } })
    },
    done(label: string) {
      const s = S()
      if (s.doc && s.doc !== s.history[s.hIndex]?.doc) commit(label)
    },
  }), [id])
}

export function PropertiesPanel() {
  const layer = useStore(s => s.doc?.layers.find(l => l.id === s.doc?.activeId))
  if (!layer) return <Empty />
  return (
    <div className="space-y-3 px-3 pb-3">
      {layer.kind === 'adjust' && <AdjustProps layer={layer} key={layer.id} />}
      {layer.kind === 'text' && <TextProps layer={layer} key={layer.id} />}
      {layer.kind === 'shape' && <ShapeProps layer={layer} key={layer.id} />}
      {layer.kind === 'raster' && <RasterProps layer={layer} key={layer.id} />}
    </div>
  )
}

function Empty() {
  return <div className="px-3 pb-3 text-ink-400">Select a layer</div>
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[10.5px] font-medium tracking-wide text-ink-400 uppercase">{children}</div>
}

function RasterProps({ layer }: { layer: RasterLayer }) {
  const live = useLive(layer.id)
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <NumField label="X" value={layer.x} onChange={v => { live.change({ x: Math.round(v) }); live.done('Move') }} />
        <NumField label="Y" value={layer.y} onChange={v => { live.change({ y: Math.round(v) }); live.done('Move') }} />
      </div>
      <div className="flex items-center gap-1">
        <IconBtn icon={<FlipHorizontal2 size={15} />} tip="Flip horizontal" onClick={() => flipLayer('h')} size="sm" className="h-7 w-7" />
        <IconBtn icon={<FlipVertical2 size={15} />} tip="Flip vertical" onClick={() => flipLayer('v')} size="sm" className="h-7 w-7" />
        <span className="ml-auto font-mono text-[10.5px] text-ink-400">{layer.bmp.canvas.width} × {layer.bmp.canvas.height}</span>
      </div>
    </>
  )
}

// --- Text ---------------------------------------------------------------------

function TextProps({ layer }: { layer: TextLayer }) {
  const live = useLive(layer.id)
  const fonts = useFonts()
  const set1 = (patch: Partial<TextLayer>, label = 'Text style') => { live.change(patch); live.done(label) }
  return (
    <>
      <textarea
        className="num h-16 w-full resize-none py-1.5 font-sans text-[12.5px] leading-snug"
        value={layer.text}
        onChange={e => live.change({ text: e.target.value, name: e.target.value.split('\n')[0].slice(0, 32) || 'Text' })}
        onBlur={() => live.done('Edit text')}
        onKeyDown={e => e.stopPropagation()}
      />
      <Select value={layer.font} onChange={v => set1({ font: v })} options={[...new Set([layer.font, ...fonts])].map(f => ({ id: f, label: f.replace(' Variable', '') }))} className="w-full" tip="Font" />
      <div className="flex items-center gap-2">
        <Select value={String(layer.weight)} onChange={v => set1({ weight: Number(v) })} options={[300, 400, 500, 600, 700, 800, 900].map(w => ({ id: String(w), label: String(w) }))} tip="Weight" className="w-20" />
        <IconBtn icon={<Italic size={14} />} tip="Italic" active={layer.italic} onClick={() => set1({ italic: !layer.italic })} size="sm" className="h-7 w-7" />
        <Segmented value={layer.align} onChange={v => set1({ align: v })} options={[{ id: 'left', icon: <AlignLeft size={13} />, tip: 'Left' }, { id: 'center', icon: <AlignCenter size={13} />, tip: 'Center' }, { id: 'right', icon: <AlignRight size={13} />, tip: 'Right' }]} />
        <ColorSwatch value={layer.color} onChange={c => live.change({ color: c })} onDone={() => live.done('Text color')} tip="Text color" size={26} className="ml-auto" />
      </div>
      <Slider label="Size" value={Math.round(layer.size)} min={4} max={500} onChange={v => live.change({ size: v })} onCommit={() => live.done('Font size')} unit="px" wide />
      <Slider label="Leading" value={layer.lineHeight} min={0.7} max={3} step={0.05} onChange={v => live.change({ lineHeight: v })} onCommit={() => live.done('Leading')} wide />
      <div className="grid grid-cols-2 gap-2">
        <NumField label="X" value={layer.x} onChange={v => set1({ x: v }, 'Move')} />
        <NumField label="Y" value={layer.y} onChange={v => set1({ y: v }, 'Move')} />
      </div>
      <Btn onClick={() => rasterize(layer.id)} className="w-full">Rasterize</Btn>
    </>
  )
}

// --- Shape --------------------------------------------------------------------

function ShapeProps({ layer }: { layer: ShapeLayer }) {
  const live = useLive(layer.id)
  const set1 = (patch: Partial<ShapeLayer>, label = 'Shape style') => { live.change(patch); live.done(label) }
  const isLine = layer.shape === 'line'
  return (
    <>
      {!isLine && (
        <div className="flex items-center gap-2">
          <Check label="Fill" checked={!!layer.fill} onChange={v => set1({ fill: v ? S().fg : null })} />
          {layer.fill && <ColorSwatch value={layer.fill} onChange={c => live.change({ fill: c })} onDone={() => live.done('Fill color')} tip="Fill color" className="ml-auto" size={24} />}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Check label="Stroke" checked={!!layer.stroke} onChange={v => set1({ stroke: v ? S().fg : null })} />
        {layer.stroke && <ColorSwatch value={layer.stroke} onChange={c => live.change({ stroke: c })} onDone={() => live.done('Stroke color')} tip="Stroke color" className="ml-auto" size={24} />}
      </div>
      {layer.stroke && <Slider label="Width" value={layer.strokeWidth} min={1} max={200} onChange={v => live.change({ strokeWidth: v })} onCommit={() => live.done('Stroke width')} unit="px" wide />}
      {layer.shape === 'rect' && <Slider label="Radius" value={layer.radius} min={0} max={Math.round(Math.min(Math.abs(layer.w), Math.abs(layer.h)) / 2)} onChange={v => live.change({ radius: v })} onCommit={() => live.done('Corner radius')} unit="px" wide />}
      <div className="grid grid-cols-2 gap-2">
        <NumField label="X" value={layer.x} onChange={v => set1({ x: v }, 'Move')} />
        <NumField label="Y" value={layer.y} onChange={v => set1({ y: v }, 'Move')} />
        <NumField label="W" value={layer.w} onChange={v => set1({ w: v }, 'Resize shape')} />
        <NumField label="H" value={layer.h} onChange={v => set1({ h: v }, 'Resize shape')} />
      </div>
      <Btn onClick={() => rasterize(layer.id)} className="w-full">Rasterize</Btn>
    </>
  )
}

// --- Adjustments -----------------------------------------------------------------

const ids = new WeakMap<object, number>()
let nextId = 0
const objId = (o: object) => {
  if (!ids.has(o)) ids.set(o, ++nextId)
  return ids.get(o)!
}

function useBelowHistogram(layerId: string) {
  const doc = useStore(s => s.doc) as Doc
  const ver = useStore(s => s.ver)
  const i = doc.layers.findIndex(l => l.id === layerId)
  const below = doc.layers.slice(0, Math.max(0, i))
  const key = below.map(objId).join() + `|${doc.width}x${doc.height}|${ver}`
  return useMemo(() => {
    const k = Math.min(1, 320 / Math.max(doc.width, doc.height))
    const c = makeCanvas(doc.width, doc.height)
    compositeLayers(ctx2d(c), below, doc.width, doc.height)
    const small = makeCanvas(doc.width * k, doc.height * k)
    ctx2d(small).drawImage(c, 0, 0, small.width, small.height)
    return histogram(ctx2d(small, true).getImageData(0, 0, small.width, small.height).data)
    // Recompute only when the layers below change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

function Histogram({ data, channel = 'l' }: { data: ReturnType<typeof histogram>; channel?: 'l' | 'r' | 'g' | 'b' }) {
  const arr = data[channel]
  let max = 1
  for (let i = 2; i < 254; i++) max = Math.max(max, arr[i])
  const pts = Array.from(arr, (v, i) => `${i},${100 - Math.min(100, (v / max) * 96)}`).join(' ')
  const color = { l: '#8a8a93', r: '#ff5c5c', g: '#5cff8a', b: '#5c9dff' }[channel]
  return (
    <svg viewBox="0 0 255 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
      <polygon points={`0,100 ${pts} 255,100`} fill={color} opacity=".28" />
    </svg>
  )
}

function AdjustProps({ layer }: { layer: AdjustLayer }) {
  const live = useLive(layer.id)
  const a = layer.adj
  const upd = (patch: Partial<Adjustment>) => live.change({ adj: { ...a, ...patch } as Adjustment })
  const done = () => live.done(adjustmentLabel(a.type))
  const reset = () => { live.change({ adj: defaultAdjustment(a.type) }); live.done('Reset ' + adjustmentLabel(a.type)) }
  const S_ = (label: string, key: string, min: number, max: number, step = 1, unit = '') => (
    <Slider key={key} label={label} value={(a as unknown as Record<string, number>)[key]} min={min} max={max} step={step} unit={unit} onChange={v => upd({ [key]: v } as Partial<Adjustment>)} onCommit={done} wide />
  )
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-medium">{adjustmentLabel(a.type)}</span>
        {a.type !== 'invert' && <IconBtn icon={<RotateCcw size={13} />} tip="Reset" onClick={reset} size="sm" />}
      </div>
      {a.type === 'brightness' && <>{S_('Brightness', 'brightness', -100, 100)}{S_('Contrast', 'contrast', -100, 100)}</>}
      {a.type === 'exposure' && <>{S_('Exposure', 'exposure', -5, 5, 0.01)}{S_('Offset', 'offset', -0.5, 0.5, 0.005)}{S_('Gamma', 'gamma', 0.1, 3, 0.01)}</>}
      {a.type === 'vibrance' && <>{S_('Vibrance', 'vibrance', -100, 100)}{S_('Saturation', 'saturation', -100, 100)}</>}
      {a.type === 'hue' && (
        <>
          <div className="h-2 rounded-full" style={{ background: `linear-gradient(to right, ${Array.from({ length: 7 }, (_, i) => `hsl(${i * 60 + a.hue} 90% 55%)`).join(',')})` }} />
          {S_('Hue', 'hue', -180, 180, 1, '°')}{S_('Saturation', 'saturation', -100, 100)}{S_('Lightness', 'lightness', -100, 100)}
        </>
      )}
      {a.type === 'bw' && (
        <>
          {S_('Reds', 'reds', -200, 300, 1, '%')}{S_('Yellows', 'yellows', -200, 300, 1, '%')}{S_('Greens', 'greens', -200, 300, 1, '%')}
          {S_('Cyans', 'cyans', -200, 300, 1, '%')}{S_('Blues', 'blues', -200, 300, 1, '%')}{S_('Magentas', 'magentas', -200, 300, 1, '%')}
        </>
      )}
      {a.type === 'invert' && <div className="text-ink-400">No settings. Use opacity to blend.</div>}
      {a.type === 'levels' && <Levels layer={layer} upd={upd} done={done} />}
      {a.type === 'curves' && <Curves layer={layer} upd={upd} done={done} />}
    </>
  )
}

function Levels({ layer, upd, done }: { layer: AdjustLayer; upd: (p: Partial<Adjustment>) => void; done: () => void }) {
  const a = layer.adj as Extract<Adjustment, { type: 'levels' }>
  const hist = useBelowHistogram(layer.id)
  const gammaPos = a.inBlack + (a.inWhite - a.inBlack) * 0.5 ** (1 / a.gamma)
  return (
    <>
      <div className="relative h-24 overflow-hidden rounded-lg border border-white/6 bg-ink-950">
        <Histogram data={hist} />
        <div className="absolute inset-y-0 left-0 bg-black/50" style={{ width: `${(a.inBlack / 255) * 100}%` }} />
        <div className="absolute inset-y-0 right-0 bg-black/50" style={{ width: `${(1 - a.inWhite / 255) * 100}%` }} />
        <div className="absolute inset-y-0 w-px bg-ink-200/60" style={{ left: `${(gammaPos / 255) * 100}%` }} />
      </div>
      <Label>Input</Label>
      <Slider label="Black" value={a.inBlack} min={0} max={a.inWhite - 2} onChange={v => upd({ inBlack: v })} onCommit={done} wide />
      <Slider label="Midtones" value={a.gamma} min={0.1} max={9.99} step={0.01} onChange={v => upd({ gamma: v })} onCommit={done} wide />
      <Slider label="White" value={a.inWhite} min={a.inBlack + 2} max={255} onChange={v => upd({ inWhite: v })} onCommit={done} wide />
      <Label>Output</Label>
      <div className="h-2 rounded-full" style={{ background: `linear-gradient(to right, rgb(${a.outBlack},${a.outBlack},${a.outBlack}), rgb(${a.outWhite},${a.outWhite},${a.outWhite}))` }} />
      <Slider label="Black" value={a.outBlack} min={0} max={255} onChange={v => upd({ outBlack: v })} onCommit={done} wide />
      <Slider label="White" value={a.outWhite} min={0} max={255} onChange={v => upd({ outWhite: v })} onCommit={done} wide />
    </>
  )
}

type Chan = 'rgb' | 'r' | 'g' | 'b'

function Curves({ layer, upd, done }: { layer: AdjustLayer; upd: (p: Partial<Adjustment>) => void; done: () => void }) {
  const a = layer.adj as Extract<Adjustment, { type: 'curves' }>
  const [ch, setCh] = useState<Chan>('rgb')
  const hist = useBelowHistogram(layer.id)
  const svg = useRef<SVGSVGElement>(null)
  const dragging = useRef<number | null>(null)
  const pts = a[ch]
  const lut = curveLut(pts)
  const path = Array.from(lut, (v, i) => `${i === 0 ? 'M' : 'L'}${i},${255 - v}`).join(' ')
  const color = { rgb: '#fafafa', r: '#ff5c5c', g: '#5cff8a', b: '#5c9dff' }[ch]

  const toPt = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = svg.current!.getBoundingClientRect()
    return [
      Math.round(Math.min(255, Math.max(0, ((e.clientX - r.left) / r.width) * 255))),
      Math.round(Math.min(255, Math.max(0, 255 - ((e.clientY - r.top) / r.height) * 255))),
    ]
  }
  const setPts = (p: CurvePoints) => upd({ [ch]: p } as Partial<Adjustment>)

  const onDown = (e: React.PointerEvent) => {
    capture(svg.current!, e.pointerId)
    const [x, y] = toPt(e)
    let idx = pts.findIndex(p => Math.abs(p[0] - x) < 10 && Math.abs(p[1] - y) < 14)
    if (idx < 0) {
      const next = [...pts, [x, lut[x]] as [number, number]].sort((p, q) => p[0] - q[0])
      idx = next.findIndex(p => p[0] === x)
      setPts(next)
    }
    dragging.current = idx
  }
  const onMove = (e: React.PointerEvent) => {
    const i = dragging.current
    if (i === null) return
    const [x, y] = toPt(e)
    const cur = (S().doc!.layers.find(l => l.id === layer.id) as AdjustLayer).adj as typeof a
    const list = [...cur[ch]]
    const lo = i > 0 ? list[i - 1][0] + 1 : 0
    const hi = i < list.length - 1 ? list[i + 1][0] - 1 : 255
    const r = svg.current!.getBoundingClientRect()
    // Dragging an inner point far outside removes it.
    if (i > 0 && i < list.length - 1 && (e.clientY < r.top - 24 || e.clientY > r.bottom + 24)) {
      list.splice(i, 1)
      dragging.current = null
      setPts(list)
      return
    }
    list[i] = [i === 0 ? Math.min(x, hi) : i === list.length - 1 ? Math.max(x, lo) : Math.min(hi, Math.max(lo, x)), y]
    setPts(list)
  }
  const onUp = () => {
    if (dragging.current !== null) done()
    dragging.current = null
  }

  return (
    <>
      <Segmented value={ch} onChange={setCh} options={[{ id: 'rgb', label: 'RGB' }, { id: 'r', label: 'Red' }, { id: 'g', label: 'Green' }, { id: 'b', label: 'Blue' }]} className="w-full [&>button]:flex-1" />
      <div className="relative aspect-square overflow-hidden rounded-lg border border-white/6 bg-ink-950">
        <Histogram data={hist} channel={ch === 'rgb' ? 'l' : ch} />
        <svg ref={svg} viewBox="-4 -4 263 263" className="absolute inset-0 h-full w-full cursor-crosshair touch-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
          {[64, 128, 192].map(v => <g key={v} stroke="#26262a" strokeWidth="1"><line x1={v} y1="0" x2={v} y2="255" /><line x1="0" y1={v} x2="255" y2={v} /></g>)}
          <line x1="0" y1="255" x2="255" y2="0" stroke="#34343a" strokeDasharray="3 3" />
          <path d={path} fill="none" stroke={color} strokeWidth="2" />
          {pts.map((p, i) => (
            <circle
              key={i}
              cx={p[0]}
              cy={255 - p[1]}
              r="5"
              fill="#0b0b0c"
              stroke={color}
              strokeWidth="2"
              onDoubleClick={() => { if (i > 0 && i < pts.length - 1) { setPts(pts.filter((_, j) => j !== i)); done() } }}
            />
          ))}
        </svg>
      </div>
      <div className={cx('text-[11px] text-ink-400')}>Click to add a point · drag it off to remove</div>
    </>
  )
}
