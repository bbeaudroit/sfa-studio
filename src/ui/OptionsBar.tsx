import { AlignCenter, AlignLeft, AlignRight, ArrowLeftRight, Check as CheckIcon, Circle, Minus, Square, SquareDashed, CircleDashed, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { TOOL_DEFS } from '../commands'
import { setOpt, useStore } from '../core/store'
import { applyCrop, cropSize, resetCrop } from '../tools/tools'
import { FONTS, useFonts } from './fonts'
import { Check, Segmented, Select, Slider, Btn } from './kit'
import { ToolIcon } from './Toolbar'

const MODES = [
  { id: 'new' as const, label: 'New', tip: 'New selection' },
  { id: 'add' as const, label: 'Add', tip: 'Add (hold Shift)' },
  { id: 'subtract' as const, label: 'Sub', tip: 'Subtract (hold Alt)' },
  { id: 'intersect' as const, label: '∩', tip: 'Intersect (Shift+Alt)' },
]

const ASPECTS = [
  { id: 'free', label: 'Free' },
  { id: 'original', label: 'Original' },
  { id: '1:1', label: '1 : 1' },
  { id: '4:5', label: '4 : 5' },
  { id: '3:2', label: '3 : 2' },
  { id: '4:3', label: '4 : 3' },
  { id: '16:9', label: '16 : 9' },
  { id: '9:16', label: '9 : 16' },
  { id: '2:3', label: '2 : 3' },
]

function Group({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-3">{children}</div>
}

function Sep() {
  return <div className="h-5 w-px bg-white/8" />
}

export function OptionsBar() {
  const tool = useStore(s => s.tool)
  const o = useStore(s => s.opts)
  const hasDoc = useStore(s => !!s.doc)
  const def = TOOL_DEFS.find(t => t.id === tool)!
  return (
    <div className="flex h-10 shrink-0 items-center gap-3 overflow-x-auto border-b border-white/6 bg-ink-900 px-3 text-[12px]">
      <div className="flex items-center gap-2 pr-1 text-ink-100">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-lime/10 text-lime"><ToolIcon id={tool} size={14} /></span>
        <span className="font-medium">{def.label}</span>
      </div>
      <Sep />
      {!hasDoc ? <span className="text-ink-400">Open an image to start</span> : <ToolOptions tool={tool} o={o} />}
    </div>
  )
}

function ToolOptions({ tool, o }: { tool: string; o: ReturnType<typeof useStore.getState>['opts'] }) {
  switch (tool) {
    case 'brush':
    case 'eraser': {
      const k = tool as 'brush' | 'eraser'
      const b = o[k]
      return (
        <Group>
          <Slider label="Size" value={b.size} min={1} max={500} onChange={v => setOpt(k, { size: v })} unit="px" className="w-52" />
          <Slider label="Hardness" value={Math.round(b.hardness * 100)} min={0} max={100} onChange={v => setOpt(k, { hardness: v / 100 })} unit="%" className="w-52" />
          <Slider label="Opacity" value={Math.round(b.opacity * 100)} min={1} max={100} onChange={v => setOpt(k, { opacity: v / 100 })} unit="%" className="w-52" />
          <span className="text-ink-400">[ ] size · Shift-click line{tool === 'brush' ? ' · Alt picks color' : ''}</span>
        </Group>
      )
    }
    case 'marquee':
      return (
        <Group>
          <Segmented value={o.marquee.shape} onChange={v => setOpt('marquee', { shape: v })} options={[{ id: 'rect', icon: <SquareDashed size={14} />, tip: 'Rectangle' }, { id: 'ellipse', icon: <CircleDashed size={14} />, tip: 'Ellipse' }]} />
          <Segmented value={o.marquee.mode} onChange={v => setOpt('marquee', { mode: v })} options={MODES} />
          <Slider label="Feather" value={o.marquee.feather} min={0} max={100} onChange={v => setOpt('marquee', { feather: v })} unit="px" className="w-56" />
        </Group>
      )
    case 'lasso':
      return (
        <Group>
          <Segmented value={o.lasso.poly ? 'poly' : 'free'} onChange={v => setOpt('lasso', { poly: v === 'poly' })} options={[{ id: 'free', label: 'Freehand' }, { id: 'poly', label: 'Polygon' }]} />
          <Segmented value={o.lasso.mode} onChange={v => setOpt('lasso', { mode: v })} options={MODES} />
          <Slider label="Feather" value={o.lasso.feather} min={0} max={100} onChange={v => setOpt('lasso', { feather: v })} unit="px" className="w-56" />
          {o.lasso.poly && <span className="text-ink-400">Click points · Enter or click start to close</span>}
        </Group>
      )
    case 'wand':
      return (
        <Group>
          <Segmented value={o.wand.mode} onChange={v => setOpt('wand', { mode: v })} options={MODES} />
          <Slider label="Tolerance" value={o.wand.tolerance} min={0} max={255} onChange={v => setOpt('wand', { tolerance: v })} className="w-52" />
          <Check label="Contiguous" checked={o.wand.contiguous} onChange={v => setOpt('wand', { contiguous: v })} />
          <Check label="All layers" checked={o.wand.sampleAll} onChange={v => setOpt('wand', { sampleAll: v })} />
        </Group>
      )
    case 'bucket':
      return (
        <Group>
          <Slider label="Tolerance" value={o.bucket.tolerance} min={0} max={255} onChange={v => setOpt('bucket', { tolerance: v })} className="w-52" />
          <Check label="Contiguous" checked={o.bucket.contiguous} onChange={v => setOpt('bucket', { contiguous: v })} />
          <Check label="All layers" checked={o.bucket.sampleAll} onChange={v => setOpt('bucket', { sampleAll: v })} />
        </Group>
      )
    case 'gradient':
      return (
        <Group>
          <Segmented value={o.gradient.type} onChange={v => setOpt('gradient', { type: v })} options={[{ id: 'linear', label: 'Linear' }, { id: 'radial', label: 'Radial' }]} />
          <Segmented value={o.gradient.toTransparent ? 't' : 'bg'} onChange={v => setOpt('gradient', { toTransparent: v === 't' })} options={[{ id: 'bg', label: 'To background' }, { id: 't', label: 'To transparent' }]} />
          <span className="text-ink-400">Drag on canvas · Shift snaps 45°</span>
        </Group>
      )
    case 'crop':
      return <CropOptions />
    case 'text':
      return <TextOptions />
    case 'shape':
      return (
        <Group>
          <Segmented value={o.shape.shape} onChange={v => setOpt('shape', { shape: v })} options={[{ id: 'rect', icon: <Square size={14} />, tip: 'Rectangle' }, { id: 'ellipse', icon: <Circle size={14} />, tip: 'Ellipse' }, { id: 'line', icon: <Minus size={14} className="-rotate-45" />, tip: 'Line' }]} />
          {o.shape.shape !== 'line' && <Check label="Fill" checked={o.shape.fill} onChange={v => setOpt('shape', { fill: v })} tip="Fill with foreground" />}
          {o.shape.shape !== 'line' && <Check label="Stroke" checked={o.shape.stroke} onChange={v => setOpt('shape', { stroke: v })} tip="Stroke with background" />}
          <Slider label="Width" value={o.shape.strokeWidth} min={1} max={100} onChange={v => setOpt('shape', { strokeWidth: v })} unit="px" className="w-52" />
          {o.shape.shape === 'rect' && <Slider label="Radius" value={o.shape.radius} min={0} max={300} onChange={v => setOpt('shape', { radius: v })} unit="px" className="w-52" />}
          <span className="text-ink-400">Shift constrains · Alt from center</span>
        </Group>
      )
    case 'move':
      return (
        <Group>
          <Check label="Auto-select layer" checked={o.move.autoSelect} onChange={v => setOpt('move', { autoSelect: v })} tip="Click picks the layer under the cursor (Ctrl toggles)" />
          <span className="text-ink-400">Arrows nudge · Shift ×10 · drag rulers for guides</span>
        </Group>
      )
    case 'eyedropper':
      return <span className="text-ink-400">Click to pick foreground · Alt-click for background</span>
    case 'hand':
      return <span className="text-ink-400">Drag to pan · hold Space with any tool</span>
    case 'zoom':
      return <span className="text-ink-400">Click to zoom in · Alt-click out · Ctrl+wheel anywhere</span>
  }
  return null
}

function CropOptions() {
  const o = useStore(s => s.opts.crop)
  useStore(s => s.overlayVer)
  const size = cropSize()
  useEffect(() => { resetCrop() }, [o.aspect])
  return (
    <Group>
      <Select value={o.aspect} onChange={v => setOpt('crop', { aspect: v })} options={ASPECTS} tip="Aspect ratio" />
      {o.aspect.includes(':') && (
        <button type="button" data-tip="Swap orientation" className="grid h-7 w-7 place-items-center rounded-lg text-ink-200 hover:bg-white/8" onClick={() => { const [a, b] = o.aspect.split(':'); setOpt('crop', { aspect: `${b}:${a}` }) }}>
          <ArrowLeftRight size={14} />
        </button>
      )}
      <Check label="Delete cropped pixels" checked={o.deleteCropped} onChange={v => setOpt('crop', { deleteCropped: v })} />
      {size && <span className="font-mono text-[11px] text-ink-300">{size.w} × {size.h}</span>}
      <Sep />
      <Btn onClick={resetCrop}><X size={14} /> Reset</Btn>
      <Btn primary onClick={applyCrop}><CheckIcon size={14} /> Crop</Btn>
      <span className="text-ink-400">Enter</span>
    </Group>
  )
}

function TextOptions() {
  const o = useStore(s => s.opts.text)
  const fonts = useFonts()
  const [size, setSize] = useState(o.size)
  useEffect(() => setSize(o.size), [o.size])
  return (
    <Group>
      <Select value={o.font} onChange={v => setOpt('text', { font: v })} options={fonts.map(f => ({ id: f, label: f.replace(' Variable', '') }))} className="w-52" tip="Font" />
      <Select value={String(o.weight)} onChange={v => setOpt('text', { weight: Number(v) })} options={[300, 400, 500, 600, 700, 800, 900].map(w => ({ id: String(w), label: ({ 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' } as Record<number, string>)[w] }))} tip="Weight" />
      <Slider label="Size" value={size} min={6} max={400} onChange={v => { setSize(v); setOpt('text', { size: v }) }} unit="px" className="w-56" />
      <Segmented value={o.align} onChange={v => setOpt('text', { align: v })} options={[{ id: 'left', icon: <AlignLeft size={14} />, tip: 'Left' }, { id: 'center', icon: <AlignCenter size={14} />, tip: 'Center' }, { id: 'right', icon: <AlignRight size={14} />, tip: 'Right' }]} />
      <span className="text-ink-400">Click to type · Ctrl+Enter to finish</span>
    </Group>
  )
}

export { FONTS }
