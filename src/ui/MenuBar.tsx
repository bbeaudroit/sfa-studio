import { Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { COMMANDS, run } from '../commands'
import { isDesktop } from '../core/platform'
import { isDirty, useStore } from '../core/store'
import { Logo } from './Logo'
import { cx } from './kit'

type Item = string | '-'

const MENUS: { label: string; items: Item[] }[] = [
  { label: 'File', items: ['new', 'open', 'place', '-', 'save', 'saveAs', 'savePsd', 'export', '-', 'close'] },
  { label: 'Edit', items: ['undo', 'redo', '-', 'cut', 'copy', 'copyMerged', 'paste', 'clear', '-', 'fillFg', 'fillBg', '-', 'transform'] },
  { label: 'Image', items: ['imageSize', 'canvasSize', '-', 'rotCW', 'rotCCW', 'rot180', 'flipH', 'flipV', '-', 'cropSel', 'trim'] },
  { label: 'Layer', items: ['newLayer', 'dupLayer', 'delLayer', '-', 'layerUp', 'layerDown', 'toggleLock', '-', 'flipLayerH', 'flipLayerV', 'rasterize', '-', 'addMask', 'addMaskHide', 'toggleMask', 'applyMask', 'deleteMask', 'clip', '-', 'mergeDown', 'mergeVisible', 'flatten'] },
  { label: 'Adjust', items: ['autoTone', 'autoContrast', '-', 'adj:brightness', 'adj:levels', 'adj:curves', 'adj:exposure', '-', 'adj:vibrance', 'adj:hue', 'adj:bw', 'adj:invert'] },
  { label: 'Select', items: ['selectAll', 'deselect', 'invertSel'] },
  { label: 'Filter', items: ['blur', 'sharpen', 'noise'] },
  { label: 'View', items: ['zoomIn', 'zoomOut', 'fit', 'fill', 'actual', '-', 'rulers', 'guides', 'snap', 'clearGuides', '-', 'palette'] },
  { label: 'Help', items: ['shortcuts', '-', 'github', 'issue', 'about'] },
]

export function MenuBar() {
  const [open, setOpen] = useState<number | null>(null)
  const bar = useRef<HTMLDivElement>(null)
  const name = useStore(s => s.docName)
  const hasDoc = useStore(s => !!s.doc)
  useStore(s => s.hIndex)
  useStore(s => s.savedId)
  useStore(s => s.doc)
  const dirty = isDirty()

  useEffect(() => {
    if (open === null) return
    const close = (e: PointerEvent) => { if (!bar.current?.contains(e.target as Node)) setOpen(null) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', esc)
    window.addEventListener('blur', () => setOpen(null))
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', esc) }
  }, [open])

  useEffect(() => {
    document.title = hasDoc ? `${dirty ? '• ' : ''}${name} — SFA Studio` : 'SFA Studio'
    window.sfa?.setTitle(document.title)
    window.sfa?.setDirty(dirty)
  }, [name, dirty, hasDoc])

  return (
    <header ref={bar} className="drag relative flex h-10 shrink-0 items-center border-b border-white/6 bg-ink-950 pl-3" style={{ paddingRight: isDesktop ? 140 : 12 }}>
      <div className="flex items-center gap-2 pr-3">
        <Logo size={18} />
        <span className="text-[12.5px] font-semibold tracking-tight">Studio</span>
      </div>
      <nav className="no-drag flex items-center">
        {MENUS.map((m, i) => (
          <div key={m.label} className="relative">
            <button
              type="button"
              className={cx('h-7 rounded-md px-2.5 text-[12.5px] transition-colors', open === i ? 'bg-white/10 text-white' : 'text-ink-200 hover:bg-white/6 hover:text-white')}
              onPointerDown={e => { e.preventDefault(); setOpen(open === i ? null : i) }}
              onPointerEnter={() => open !== null && setOpen(i)}
            >
              {m.label}
            </button>
            {open === i && <Menu items={m.items} onDone={() => setOpen(null)} />}
          </div>
        ))}
      </nav>
      <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-1.5 text-[12px] text-ink-300">
        {hasDoc && (
          <>
            <span className="max-w-[28vw] truncate">{name}</span>
            {dirty && <span className="h-1.5 w-1.5 rounded-full bg-lime" title="Unsaved changes" />}
          </>
        )}
      </div>
    </header>
  )
}

function Menu({ items, onDone }: { items: Item[]; onDone: () => void }) {
  return (
    <div className="absolute top-full left-0 z-50 mt-1 min-w-60 animate-pop rounded-xl border border-white/10 bg-ink-800/98 p-1 shadow-2xl shadow-black/70 backdrop-blur">
      {items.map((id, i) => {
        if (id === '-') return <div key={i} className="mx-2 my-1 h-px bg-white/8" />
        const c = COMMANDS[id]
        const enabled = !c.enabled || c.enabled()
        const checked = c.checked?.()
        return (
          <button
            key={id}
            type="button"
            disabled={!enabled}
            onClick={() => { onDone(); setTimeout(() => run(id)) }}
            className="group flex h-7 w-full items-center gap-2 rounded-md pr-2 pl-2 text-left text-[12.5px] text-ink-100 enabled:hover:bg-lime enabled:hover:text-ink-950 disabled:text-ink-500"
          >
            <span className="w-3.5 shrink-0">{checked && <Check size={13} />}</span>
            <span className="flex-1">{c.label}</span>
            {c.keys && <span className="font-mono text-[10.5px] text-ink-400 group-enabled:group-hover:text-ink-950/70">{c.keys}</span>}
          </button>
        )
      })}
    </div>
  )
}
