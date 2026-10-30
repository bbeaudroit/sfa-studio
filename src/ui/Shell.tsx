import { FilePlus2, FolderOpen, Image as ImageIcon, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { openDialog, openPath } from '../core/files'
import { baseName, isDesktop, recentFiles } from '../core/platform'
import { S, set, useStore } from '../core/store'
import { Kbd, cx } from './kit'
import { Logo } from './Logo'

export function EmptyState() {
  const [recent, setRecent] = useState<string[]>([])
  useEffect(() => setRecent(isDesktop ? recentFiles() : []), [])
  return (
    <div className="absolute inset-0 grid place-items-center overflow-y-auto p-8">
      <div className="w-full max-w-[460px] animate-rise">
        <div className="mb-8 flex items-center gap-3">
          <Logo size={34} />
          <div>
            <h1 className="text-[22px] leading-tight font-semibold tracking-tight">SFA Studio</h1>
            <p className="text-ink-400">Layers, selections, adjustments. Free.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={openDialog}
            className="group flex flex-col items-start gap-6 rounded-2xl bg-lime p-4 text-left text-ink-950 transition-transform duration-150 hover:-translate-y-0.5 active:scale-[.98]"
          >
            <FolderOpen size={20} strokeWidth={2} />
            <div>
              <div className="text-[14px] font-semibold">Open image</div>
              <div className="text-[11.5px] opacity-60">PNG, JPG, WebP, .sfas · Ctrl+O</div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => set({ dialog: 'new' })}
            className="group flex flex-col items-start gap-6 rounded-2xl border border-white/10 bg-ink-850 p-4 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-white/20 active:scale-[.98]"
          >
            <FilePlus2 size={20} strokeWidth={2} className="text-lime" />
            <div>
              <div className="text-[14px] font-semibold">New canvas</div>
              <div className="text-[11.5px] text-ink-400">Any size · Ctrl+N</div>
            </div>
          </button>
        </div>
        <div className="mt-3 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 py-3 text-ink-400">
          <ImageIcon size={14} /> Drop an image here or paste with <Kbd>Ctrl+V</Kbd>
        </div>
        {recent.length > 0 && (
          <div className="mt-6">
            <div className="mb-1.5 text-[10.5px] font-medium tracking-wide text-ink-400 uppercase">Recent</div>
            <div className="space-y-px">
              {recent.slice(0, 6).map(p => (
                <button key={p} type="button" onClick={() => openPath(p)} className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-white/5">
                  <span className="truncate text-ink-100">{baseName(p)}</span>
                  <span className="ml-auto max-w-[55%] truncate text-[11px] text-ink-500" dir="rtl">{p}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function DropOverlay() {
  const [over, setOver] = useState(false)
  useEffect(() => {
    let depth = 0
    const isFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent) => { if (isFiles(e)) { depth++; setOver(true) } }
    const leave = (e: DragEvent) => { if (isFiles(e) && --depth <= 0) { depth = 0; setOver(false) } }
    const drop = () => { depth = 0; setOver(false) }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop) }
  }, [])
  const hasDoc = useStore(s => !!s.doc)
  if (!over) return null
  return (
    <div className="pointer-events-none fixed inset-2 z-[90] grid animate-fade place-items-center rounded-2xl border-2 border-dashed border-lime bg-lime/[.06]">
      <div className="rounded-xl bg-ink-900/90 px-4 py-2.5 text-[13px] font-medium text-lime">{hasDoc ? 'Drop to add as layer' : 'Drop to open'}</div>
    </div>
  )
}

export function Toasts() {
  const toasts = useStore(s => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-10 left-1/2 z-[80] flex -translate-x-1/2 flex-col items-center gap-1.5">
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto flex animate-rise items-center gap-3 rounded-xl border border-white/10 bg-ink-800/95 py-2 pr-2 pl-3.5 text-[12.5px] shadow-xl shadow-black/60 backdrop-blur">
          <span>{t.text}</span>
          {t.action && (
            <button type="button" className="rounded-md bg-lime px-2 py-0.5 text-[12px] font-medium text-ink-950" onClick={() => { t.action!.run(); set(s => ({ toasts: s.toasts.filter(x => x.id !== t.id) })) }}>
              {t.action.label}
            </button>
          )}
          {!t.action && <span className="w-1" />}
        </div>
      ))}
    </div>
  )
}

const HINT_KEY = 'sfa.studio.hint.v1'

export function Onboarding() {
  const hasDoc = useStore(s => !!s.doc)
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!hasDoc) return
    try { if (!localStorage.getItem(HINT_KEY)) setShow(true) } catch { /* ignore */ }
  }, [hasDoc])
  if (!show) return null
  const done = () => {
    setShow(false)
    try { localStorage.setItem(HINT_KEY, '1') } catch { /* ignore */ }
  }
  const tips: [string, string][] = [
    ['Pick a tool', 'Left bar. Hover for its key.'],
    ['Layers', 'Right panel. Drag to reorder.'],
    ['Adjust', 'Adds editable adjustment layers.'],
    ['Pan & zoom', 'Space-drag · Ctrl+wheel'],
  ]
  return (
    <div className="fixed bottom-10 left-16 z-[70] w-72 animate-rise rounded-2xl border border-lime/30 bg-ink-850 p-4 shadow-2xl shadow-black/70">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-semibold">Quick start</span>
        <button type="button" aria-label="Dismiss" onClick={done} className="grid h-6 w-6 place-items-center rounded-md text-ink-300 hover:bg-white/8"><X size={14} /></button>
      </div>
      <ol className="space-y-2">
        {tips.map(([a, b], i) => (
          <li key={a} className="flex gap-2.5">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-lime/15 font-mono text-[10.5px] text-lime">{i + 1}</span>
            <span><span className="text-ink-100">{a}</span> <span className="text-ink-400">— {b}</span></span>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11.5px] text-ink-400">All shortcuts: <Kbd>?</Kbd></span>
        <button type="button" onClick={done} className="rounded-lg bg-lime px-3 py-1 text-[12px] font-medium text-ink-950">Got it</button>
      </div>
    </div>
  )
}

export function StatusBar() {
  const doc = useStore(s => s.doc)
  const cursor = useStore(s => s.cursor)
  const zoom = useStore(s => s.view.zoom)
  const sel = useStore(s => !!s.doc?.selection)
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-white/6 bg-ink-950 px-3 font-mono text-[10.5px] text-ink-400">
      {doc ? (
        <>
          <span>{Math.round(zoom * 100)}%</span>
          <span>{doc.width} × {doc.height}px</span>
          <span className={cx('tabular-nums', !cursor && 'opacity-0')}>{cursor ? `${Math.floor(cursor.x)}, ${Math.floor(cursor.y)}` : '0, 0'}</span>
          {sel && <span className="text-lime">Selection · Ctrl+D to clear</span>}
          <span className="ml-auto">{doc.layers.length} layer{doc.layers.length === 1 ? '' : 's'}</span>
          <button type="button" className="font-sans text-ink-300 hover:text-white" onClick={() => set({ dialog: 'shortcuts' })}>Shortcuts <Kbd>?</Kbd></button>
        </>
      ) : (
        <>
          <span>Ready</span>
        </>
      )}
    </footer>
  )
}

export function isTyping(e: Event) {
  const t = e.target as HTMLElement | null
  return !!t?.closest?.('input,textarea,select,[contenteditable="true"]') || !!S().textEditId
}
