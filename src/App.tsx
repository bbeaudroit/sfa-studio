import { ChevronDown } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { commandForKey, run } from './commands'
import { openFiles, openPath, paste } from './core/files'
import { bridge } from './core/platform'
import { S, set, setOpt, useStore, type ToolId } from './core/store'
import { TOOLS, isToolBusy } from './tools/tools'
import { Dialogs } from './ui/dialogs/Dialogs'
import { MenuBar } from './ui/MenuBar'
import { OptionsBar } from './ui/OptionsBar'
import { HistoryPanel } from './ui/panels/History'
import { LayersPanel } from './ui/panels/Layers'
import { Navigator } from './ui/panels/Navigator'
import { PropertiesPanel } from './ui/panels/Properties'
import { DropOverlay, EmptyState, Onboarding, StatusBar, Toasts, isTyping } from './ui/Shell'
import { Toolbar } from './ui/Toolbar'
import { Viewport } from './ui/Viewport'
import { TooltipLayer, cx } from './ui/kit'
import { adjustmentLabel } from './core/adjustments'

function Section({ title, children, defaultOpen = true, grow, right, id }: { title: string; children: ReactNode; defaultOpen?: boolean; grow?: boolean; right?: ReactNode; id: string }) {
  const [open, setOpen] = useState(() => {
    try { return (localStorage.getItem(`sfa.studio.panel.${id}`) ?? (defaultOpen ? '1' : '0')) === '1' } catch { return defaultOpen }
  })
  useEffect(() => { try { localStorage.setItem(`sfa.studio.panel.${id}`, open ? '1' : '0') } catch { /* ignore */ } }, [open, id])
  return (
    <section className={cx('flex flex-col border-b border-white/6', grow && open && 'min-h-0 flex-1')}>
      <button type="button" onClick={() => setOpen(o => !o)} className="flex h-9 shrink-0 items-center gap-1.5 px-3 text-[11px] font-medium tracking-wide text-ink-300 uppercase hover:text-white">
        <ChevronDown size={13} className={cx('transition-transform duration-150', !open && '-rotate-90')} />
        {title}
        <span className="ml-auto normal-case">{right}</span>
      </button>
      {open && children}
    </section>
  )
}

function PropsTitle() {
  const l = useStore(s => s.doc?.layers.find(x => x.id === s.doc?.activeId))
  if (!l) return <>Properties</>
  return <>{l.kind === 'adjust' ? adjustmentLabel(l.adj.type) : l.kind === 'text' ? 'Text' : l.kind === 'shape' ? 'Shape' : 'Layer'}</>
}

function Dock() {
  const [tab, setTab] = useState<'layers' | 'history'>('layers')
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-white/6 bg-ink-900">
      <Section title="Navigator" id="nav"><Navigator /></Section>
      <Section title="Properties" id="props" right={<span className="text-ink-400"><PropsTitle /></span>}><div className="max-h-[42vh] overflow-y-auto"><PropertiesPanel /></div></Section>
      <section className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-1 px-2">
          {(['layers', 'history'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cx('h-7 rounded-md px-2.5 text-[11px] font-medium tracking-wide uppercase transition-colors', tab === t ? 'bg-white/8 text-white' : 'text-ink-400 hover:text-white')}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === 'layers' ? <LayersPanel /> : <HistoryPanel />}
      </section>
    </aside>
  )
}

const TOOL_KEYS: Record<string, ToolId[]> = {
  V: ['move'], M: ['marquee'], L: ['lasso'], W: ['wand'], C: ['crop'], I: ['eyedropper'], B: ['brush'],
  E: ['eraser'], G: ['bucket', 'gradient'], T: ['text'], U: ['shape'], H: ['hand'], Z: ['zoom'],
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || S().dialog) return
      const tool = TOOLS[S().tool]
      if (tool.key?.(e)) { e.preventDefault(); return }
      const id = commandForKey(e)
      if (id) {
        e.preventDefault()
        run(id)
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (!S().doc) return
      const k = e.key.toUpperCase()
      if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) { set({ dialog: 'shortcuts' }); return }
      if (isToolBusy()) return
      if (TOOL_KEYS[k]) {
        e.preventDefault()
        const list = TOOL_KEYS[k]
        const cur = S().tool
        if (e.shiftKey && k === 'M' && cur === 'marquee') return setOpt('marquee', { shape: S().opts.marquee.shape === 'rect' ? 'ellipse' : 'rect' })
        if (e.shiftKey && k === 'U' && cur === 'shape') {
          const order = ['rect', 'ellipse', 'line'] as const
          return setOpt('shape', { shape: order[(order.indexOf(S().opts.shape.shape) + 1) % 3] })
        }
        const i = list.indexOf(cur)
        set({ tool: i >= 0 ? list[(i + 1) % list.length] : list[0] })
        return
      }
      if (e.key === 'x' || e.key === 'X') return set(s => ({ fg: s.bg, bg: s.fg }))
      if (e.key === 'd' || e.key === 'D') return set({ fg: '#000000', bg: '#ffffff' })
      const t = S().tool
      if ((t === 'brush' || t === 'eraser') && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
        const o = S().opts[t]
        const up = e.code === 'BracketRight'
        if (e.shiftKey) setOpt(t, { hardness: Math.min(1, Math.max(0, o.hardness + (up ? 0.1 : -0.1))) })
        else {
          const step = o.size < 10 ? 1 : o.size < 50 ? 5 : o.size < 200 ? 10 : 25
          setOpt(t, { size: Math.min(500, Math.max(1, o.size + (up ? step : -step))) })
        }
        return
      }
      if ((t === 'brush' || t === 'eraser') && /^Digit\d$/.test(e.code)) {
        const n = Number(e.code.slice(5))
        setOpt(t, { opacity: n === 0 ? 1 : n / 10 })
      }
      if (e.key === 'Escape' && S().doc?.selection) run('deselect')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function useFileInput() {
  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault() }
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return
      e.preventDefault()
      openFiles([...e.dataTransfer.files], true)
    }
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e)) return
      e.preventDefault()
      paste(e)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    window.addEventListener('paste', onPaste)
    if (bridge) {
      bridge.onOpenPath(p => openPath(p))
      bridge.initialFile().then(p => { if (p) openPath(p) })
    }
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
      window.removeEventListener('paste', onPaste)
    }
  }, [])
}

export default function App() {
  const hasDoc = useStore(s => !!s.doc)
  const tool = useStore(s => s.tool)
  useKeyboard()
  useFileInput()

  // Tool lifecycle
  useEffect(() => {
    TOOLS[tool].activate?.()
    return () => TOOLS[tool].deactivate?.()
  }, [tool, hasDoc])

  return (
    <div className="flex h-full flex-col">
      <MenuBar />
      <OptionsBar />
      <div className="flex min-h-0 flex-1">
        <Toolbar />
        <main className="relative flex min-w-0 flex-1">
          <Viewport />
          {!hasDoc && <EmptyState />}
        </main>
        {hasDoc && <Dock />}
      </div>
      <StatusBar />
      <Dialogs />
      <Toasts />
      <Onboarding />
      <DropOverlay />
      <TooltipLayer />
    </div>
  )
}
