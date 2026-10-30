import {
  Brush, Circle, CircleDashed, Crop, Eraser, Hand, Lasso, Minus, MousePointer2, PaintBucket, Pipette,
  Droplet, Eclipse, Scaling, Square, SquareDashed, Stamp, Type, WandSparkles, ZoomIn,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { TOOL_DEFS } from '../commands'
import { set, useStore, type ToolId } from '../core/store'
import { ColorSwatch } from './ColorPicker'
import { IconBtn } from './kit'

function GradientIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="tg" x1="0" x2="1">
          <stop offset="0" stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" stroke="currentColor" strokeWidth="1.8" />
      <rect x="6" y="6" width="12" height="12" rx="2" fill="url(#tg)" />
    </svg>
  )
}

export function ToolIcon({ id, size = 17 }: { id: ToolId; size?: number }) {
  const marquee = useStore(s => s.opts.marquee.shape)
  const shape = useStore(s => s.opts.shape.shape)
  const p = { size, strokeWidth: 1.8 }
  const map: Record<ToolId, ReactNode> = {
    move: <MousePointer2 {...p} />,
    marquee: marquee === 'ellipse' ? <CircleDashed {...p} /> : <SquareDashed {...p} />,
    lasso: <Lasso {...p} />,
    wand: <WandSparkles {...p} />,
    crop: <Crop {...p} />,
    eyedropper: <Pipette {...p} />,
    brush: <Brush {...p} />,
    eraser: <Eraser {...p} />,
    clone: <Stamp {...p} />,
    dodge: <Eclipse {...p} />,
    focus: <Droplet {...p} />,
    transform: <Scaling {...p} />,
    bucket: <PaintBucket {...p} />,
    gradient: <GradientIcon size={size} />,
    text: <Type {...p} />,
    shape: shape === 'ellipse' ? <Circle {...p} /> : shape === 'line' ? <Minus {...p} className="-rotate-45" /> : <Square {...p} />,
    hand: <Hand {...p} />,
    zoom: <ZoomIn {...p} />,
  }
  return <>{map[id]}</>
}

const GROUPS: ToolId[][] = [
  ['move', 'marquee', 'lasso', 'wand'],
  ['crop', 'eyedropper'],
  ['brush', 'eraser', 'bucket', 'gradient'],
  ['clone', 'dodge', 'focus'],
  ['text', 'shape'],
  ['hand', 'zoom'],
]

export function Toolbar() {
  const tool = useStore(s => s.tool)
  const fg = useStore(s => s.fg)
  const bg = useStore(s => s.bg)
  const hasDoc = useStore(s => !!s.doc)
  return (
    <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-white/6 bg-ink-900 py-2">
      {GROUPS.map((g, i) => (
        <div key={i} className="flex flex-col items-center gap-0.5">
          {i > 0 && <div className="my-1 h-px w-6 bg-white/8" />}
          {g.map(id => {
            const def = TOOL_DEFS.find(t => t.id === id)!
            return (
              <IconBtn
                key={id}
                icon={<ToolIcon id={id} />}
                tip={def.label}
                k={def.key}
                side="right"
                active={tool === id}
                disabled={!hasDoc}
                onClick={() => set({ tool: id })}
              />
            )
          })}
        </div>
      ))}
      <div className="mt-auto flex flex-col items-center gap-1.5 pt-3">
        <div className="relative h-11 w-11">
          <ColorSwatch value={bg} onChange={c => set({ bg: c })} tip="Background color" className="absolute right-0.5 bottom-0.5" size={24} />
          <ColorSwatch value={fg} onChange={c => set({ fg: c })} tip="Foreground color" className="absolute top-0.5 left-0.5 ring-2 ring-ink-900" size={24} />
        </div>
        <div className="flex gap-0.5">
          <button type="button" data-tip="Swap colors" data-key="X" data-side="right" className="grid h-5 w-5 place-items-center rounded text-ink-300 hover:text-white" onClick={() => set(s => ({ fg: s.bg, bg: s.fg }))}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4h7.5M7.5 1.8 9.7 4 7.5 6.2M10 8H2.5M4.5 5.8 2.3 8l2.2 2.2" /></svg>
          </button>
          <button type="button" data-tip="Default colors" data-key="D" data-side="right" className="grid h-5 w-5 place-items-center rounded text-ink-300 hover:text-white" onClick={() => set({ fg: '#000000', bg: '#ffffff' })}>
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="6" height="6" rx="1" fill="#000" stroke="#fff" strokeWidth=".8" /><rect x="5" y="5" width="6" height="6" rx="1" fill="#fff" /></svg>
          </button>
        </div>
      </div>
    </aside>
  )
}
