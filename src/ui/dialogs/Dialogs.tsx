import { Link2, Link2Off } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { COMMANDS, TOOL_DEFS, openUrl } from '../../commands'
import { ctx2d, makeCanvas } from '../../core/bitmap'
import { exportImage, renderExport, type ExportFormat } from '../../core/files'
import { addNoise, gaussianBlur, unsharp } from '../../core/filters'
import { editableRaster, filterActive, newDocument, resizeCanvas, resizeImage } from '../../core/ops'
import { bridge } from '../../core/platform'
import { S, set, useStore } from '../../core/store'
import { Btn, Check, Kbd, Modal, NumField, Segmented, Slider, cx } from '../kit'
import { Logo } from '../Logo'

export function Dialogs() {
  const d = useStore(s => s.dialog)
  const close = () => set({ dialog: null })
  if (!d) return null
  if (typeof d === 'object') return <FilterDialog kind={d.filter} onClose={close} />
  switch (d) {
    case 'new': return <NewDialog onClose={close} />
    case 'export': return <ExportDialog onClose={close} />
    case 'imageSize': return <ImageSizeDialog onClose={close} />
    case 'canvasSize': return <CanvasSizeDialog onClose={close} />
    case 'shortcuts': return <ShortcutsDialog onClose={close} />
    case 'about': return <AboutDialog onClose={close} />
  }
}

// --- New ----------------------------------------------------------------------

const PRESETS = [
  { label: 'HD', w: 1920, h: 1080 },
  { label: '4K', w: 3840, h: 2160 },
  { label: 'Square', w: 1080, h: 1080 },
  { label: 'Portrait', w: 1080, h: 1350 },
  { label: 'Story', w: 1080, h: 1920 },
  { label: 'A4 300ppi', w: 2480, h: 3508 },
  { label: 'Thumbnail', w: 1280, h: 720 },
  { label: 'Icon', w: 512, h: 512 },
]

function NewDialog({ onClose }: { onClose: () => void }) {
  const [w, setW] = useState(1920)
  const [h, setH] = useState(1080)
  const [bg, setBg] = useState<'white' | 'black' | 'transparent'>('white')
  const create = () => {
    newDocument(w, h, bg === 'transparent' ? null : bg === 'white' ? '#ffffff' : '#000000')
    onClose()
  }
  return (
    <Modal title="New canvas" onClose={onClose} width={460} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary onClick={create}>Create</Btn></>}>
      <div className="grid grid-cols-4 gap-1.5">
        {PRESETS.map(p => {
          const on = p.w === w && p.h === h
          const k = 34 / Math.max(p.w, p.h)
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => { setW(p.w); setH(p.h) }}
              className={cx('flex flex-col items-center gap-1.5 rounded-xl border px-1 pt-3 pb-2 transition-colors', on ? 'border-lime/70 bg-lime/[.06]' : 'border-white/8 hover:border-white/20')}
            >
              <div className="grid h-9 place-items-center"><div className={cx('rounded-[3px] border', on ? 'border-lime' : 'border-ink-300')} style={{ width: p.w * k, height: p.h * k }} /></div>
              <span className="text-[11.5px] text-ink-100">{p.label}</span>
              <span className="font-mono text-[10px] text-ink-400">{p.w}×{p.h}</span>
            </button>
          )
        })}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <NumField label="W" value={w} min={1} max={16384} onChange={v => setW(Math.round(v))} suffix="px" />
        <NumField label="H" value={h} min={1} max={16384} onChange={v => setH(Math.round(v))} suffix="px" />
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-ink-300">Background</span>
        <Segmented value={bg} onChange={setBg} options={[{ id: 'white', label: 'White' }, { id: 'black', label: 'Black' }, { id: 'transparent', label: 'Transparent' }]} />
      </div>
    </Modal>
  )
}

// --- Export ----------------------------------------------------------------------

function fmtBytes(n: number) {
  return n > 1e6 ? `${(n / 1e6).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const doc = useStore(s => s.doc)!
  const [fmt, setFmt] = useState<ExportFormat>(() => (localStorage.getItem('sfa.studio.exportFmt') as ExportFormat) || 'png')
  const [q, setQ] = useState(90)
  const [scale, setScale] = useState(100)
  const [size, setSize] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    setSize(null)
    let url = ''
    const t = setTimeout(async () => {
      const blob = await renderExport(fmt, q / 100, scale / 100)
      setSize(blob.size)
      url = URL.createObjectURL(blob)
      setPreviewUrl(url)
    }, 220)
    return () => { clearTimeout(t); if (url) URL.revokeObjectURL(url) }
  }, [fmt, q, scale])

  const go = async () => {
    setBusy(true)
    try { localStorage.setItem('sfa.studio.exportFmt', fmt) } catch { /* ignore */ }
    const ok = await exportImage(fmt, q / 100, scale / 100)
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal title="Export image" onClose={onClose} width={520} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary onClick={go} disabled={busy}>{busy ? 'Exporting…' : 'Export'}</Btn></>}>
      <div className="flex gap-4">
        <div className="checker grid h-44 w-44 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/8">
          {previewUrl && <img src={previewUrl} alt="Export preview" className="max-h-full max-w-full object-contain" />}
        </div>
        <div className="flex-1 space-y-4">
          <Segmented value={fmt} onChange={setFmt} options={[{ id: 'png', label: 'PNG' }, { id: 'jpeg', label: 'JPG' }, { id: 'webp', label: 'WebP' }]} className="w-full [&>button]:flex-1" />
          <Slider label="Quality" value={fmt === 'png' ? 100 : q} min={1} max={100} unit="%" onChange={setQ} className={cx(fmt === 'png' && 'pointer-events-none opacity-40')} />
          <Slider label="Scale" value={scale} min={5} max={400} unit="%" onChange={setScale} />
          <div className="space-y-1 rounded-lg bg-ink-900 p-2.5 font-mono text-[11px] text-ink-300">
            <div className="flex justify-between"><span>Size</span><span className="text-ink-100">{Math.round(doc.width * scale / 100)} × {Math.round(doc.height * scale / 100)}</span></div>
            <div className="flex justify-between"><span>File</span><span className="text-ink-100">{size === null ? '…' : fmtBytes(size)}</span></div>
          </div>
          {fmt === 'png' && <div className="text-[11px] text-ink-400">Lossless, keeps transparency.</div>}
          {fmt === 'jpeg' && <div className="text-[11px] text-ink-400">Transparency becomes white.</div>}
        </div>
      </div>
    </Modal>
  )
}

// --- Image size -------------------------------------------------------------------

function ImageSizeDialog({ onClose }: { onClose: () => void }) {
  const doc = useStore(s => s.doc)!
  const [w, setW] = useState(doc.width)
  const [h, setH] = useState(doc.height)
  const [lock, setLock] = useState(true)
  const r = doc.width / doc.height
  const pct = (w / doc.width) * 100
  const apply = () => { resizeImage(Math.round(w), Math.round(h)); onClose() }
  return (
    <Modal title="Image size" onClose={onClose} width={380} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary onClick={apply}>Resize</Btn></>}>
      <div className="flex items-center gap-2">
        <div className="flex-1 space-y-2">
          <NumField label="W" value={w} min={1} max={16384} suffix="px" onChange={v => { setW(Math.round(v)); if (lock) setH(Math.max(1, Math.round(v / r))) }} />
          <NumField label="H" value={h} min={1} max={16384} suffix="px" onChange={v => { setH(Math.round(v)); if (lock) setW(Math.max(1, Math.round(v * r))) }} />
        </div>
        <button type="button" data-tip={lock ? 'Unlock ratio' : 'Lock ratio'} onClick={() => setLock(l => !l)} className={cx('grid h-16 w-8 place-items-center rounded-lg border', lock ? 'border-lime/50 text-lime' : 'border-white/10 text-ink-400')}>
          {lock ? <Link2 size={15} /> : <Link2Off size={15} />}
        </button>
      </div>
      <div className="mt-4">
        <Slider label="Scale" value={Math.round(pct)} min={1} max={400} unit="%" onChange={v => { setW(Math.max(1, Math.round(doc.width * v / 100))); setH(Math.max(1, Math.round(lock ? doc.height * v / 100 : h))) }} />
      </div>
      <div className="mt-3 text-[11px] text-ink-400">Now {doc.width} × {doc.height}. Text and shapes stay sharp.</div>
    </Modal>
  )
}

// --- Canvas size -----------------------------------------------------------------

function CanvasSizeDialog({ onClose }: { onClose: () => void }) {
  const doc = useStore(s => s.doc)!
  const [w, setW] = useState(doc.width)
  const [h, setH] = useState(doc.height)
  const [anchor, setAnchor] = useState([1, 1])
  const apply = () => { resizeCanvas(Math.round(w), Math.round(h), anchor[0], anchor[1]); onClose() }
  return (
    <Modal title="Canvas size" onClose={onClose} width={380} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn primary onClick={apply}>Apply</Btn></>}>
      <div className="flex gap-4">
        <div className="flex-1 space-y-2">
          <NumField label="W" value={w} min={1} max={16384} suffix="px" onChange={v => setW(Math.round(v))} />
          <NumField label="H" value={h} min={1} max={16384} suffix="px" onChange={v => setH(Math.round(v))} />
          <div className="pt-1 text-[11px] text-ink-400">Now {doc.width} × {doc.height}</div>
        </div>
        <div>
          <div className="mb-1.5 text-[11px] text-ink-400">Anchor</div>
          <div className="grid grid-cols-3 gap-1">
            {Array.from({ length: 9 }, (_, i) => {
              const ax = i % 3, ay = Math.floor(i / 3)
              const on = ax === anchor[0] && ay === anchor[1]
              return <button key={i} type="button" aria-label={`Anchor ${ax},${ay}`} onClick={() => setAnchor([ax, ay])} className={cx('h-6 w-6 rounded-md border transition-colors', on ? 'border-lime bg-lime' : 'border-white/10 hover:border-white/30')} />
            })}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// --- Filters ------------------------------------------------------------------------

function FilterDialog({ kind, onClose }: { kind: 'blur' | 'sharpen' | 'noise'; onClose: () => void }) {
  const [radius, setRadius] = useState(kind === 'blur' ? 4 : 1.5)
  const [amount, setAmount] = useState(kind === 'noise' ? 12 : 80)
  const [threshold, setThreshold] = useState(0)
  const [mono, setMono] = useState(true)
  const layer = useMemo(() => editableRaster(), [])
  const title = { blur: 'Gaussian blur', sharpen: 'Sharpen', noise: 'Add noise' }[kind]

  const fn = useMemo(() => (src: HTMLCanvasElement) =>
    kind === 'blur' ? gaussianBlur(src, radius) : kind === 'sharpen' ? unsharp(src, amount, radius, threshold) : addNoise(src, amount, mono),
  [kind, radius, amount, threshold, mono])

  useEffect(() => {
    if (!layer) { onClose(); return }
    const t = setTimeout(() => {
      const out = fn(layer.bmp.canvas)
      const sel = S().doc?.selection
      let shown = out
      if (sel) {
        shown = makeCanvas(out.width, out.height)
        const g = ctx2d(shown)
        g.drawImage(layer.bmp.canvas, 0, 0)
        g.globalCompositeOperation = 'destination-out'
        g.drawImage(sel.canvas, -layer.x, -layer.y)
        const m = makeCanvas(out.width, out.height)
        const mg = ctx2d(m)
        mg.drawImage(out, 0, 0)
        mg.globalCompositeOperation = 'destination-in'
        mg.drawImage(sel.canvas, -layer.x, -layer.y)
        g.globalCompositeOperation = 'source-over'
        g.drawImage(m, 0, 0)
      }
      set({ preview: { layerId: layer.id, canvas: shown, x: layer.x, y: layer.y } })
    }, 90)
    return () => clearTimeout(t)
  }, [fn, layer, onClose])

  const cancel = () => { set({ preview: null }); onClose() }
  const apply = () => { set({ preview: null }); filterActive(title, fn); onClose() }

  return (
    <Modal title={title} onClose={cancel} width={360} footer={<><Btn onClick={cancel}>Cancel</Btn><Btn primary onClick={apply}>Apply</Btn></>}>
      <div className="space-y-3">
        {kind === 'blur' && <Slider label="Radius" value={radius} min={0.1} max={100} step={0.1} unit="px" onChange={setRadius} wide />}
        {kind === 'sharpen' && (
          <>
            <Slider label="Amount" value={amount} min={1} max={500} unit="%" onChange={setAmount} wide />
            <Slider label="Radius" value={radius} min={0.1} max={20} step={0.1} unit="px" onChange={setRadius} wide />
            <Slider label="Threshold" value={threshold} min={0} max={64} onChange={setThreshold} wide />
          </>
        )}
        {kind === 'noise' && (
          <>
            <Slider label="Amount" value={amount} min={1} max={100} unit="%" onChange={setAmount} wide />
            <Check label="Monochrome" checked={mono} onChange={setMono} />
          </>
        )}
        <div className="text-[11px] text-ink-400">Previewing on canvas{S().doc?.selection ? ' · inside selection' : ''}.</div>
      </div>
    </Modal>
  )
}

// --- Shortcuts ------------------------------------------------------------------------

const SHEET: { title: string; rows: [string, string][] }[] = [
  { title: 'Tools', rows: TOOL_DEFS.filter((t, i, a) => a.findIndex(x => x.key === t.key) === i).map(t => [t.id === 'bucket' ? 'Fill / Gradient' : t.label, t.key]) },
  {
    title: 'Painting',
    rows: [['Brush size', '[  ]'], ['Hardness', 'Shift+[  ]'], ['Opacity 10–100%', '1 … 0'], ['Swap colors', 'X'], ['Default colors', 'D'], ['Pick color while painting', 'Alt'], ['Straight line', 'Shift+click'], ['Cycle marquee / shape', 'Shift+M / Shift+U']],
  },
  {
    title: 'View',
    rows: [['Pan', 'Space+drag'], ['Zoom', 'Ctrl+wheel'], ['Fit', 'Ctrl+0'], ['100%', 'Ctrl+1'], ['Rulers', 'Ctrl+R'], ['Guides', 'Ctrl+;']],
  },
  { title: 'File', rows: ['new', 'open', 'save', 'saveAs', 'export', 'place'].map(id => [COMMANDS[id].label.replace('…', ''), COMMANDS[id].keys!]) },
  { title: 'Edit', rows: ['undo', 'redo', 'copy', 'paste', 'clear', 'fillFg', 'selectAll', 'deselect', 'invertSel'].map(id => [COMMANDS[id].label.replace('…', ''), COMMANDS[id].keys!]) },
  { title: 'Layers', rows: [['New layer', 'Ctrl+Shift+N'], ['Duplicate / copy selection', 'Ctrl+J'], ['Merge down', 'Ctrl+E'], ['Move up / down', 'Ctrl+]  Ctrl+['], ['Levels / Curves', 'Ctrl+L  Ctrl+M'], ['Hue / Saturation', 'Ctrl+U'], ['Select layer pixels', 'Ctrl+click thumb'], ['Clipping mask', 'Ctrl+Alt+G'], ['Auto tone', 'Ctrl+Shift+L'], ['Search commands', 'Ctrl+F']] },
]

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} width={760}>
      <div className="grid max-h-[70vh] grid-cols-3 gap-x-6 gap-y-5 overflow-y-auto">
        {SHEET.map(g => (
          <section key={g.title}>
            <h3 className="mb-2 text-[10.5px] font-medium tracking-wide text-lime uppercase">{g.title}</h3>
            <div className="space-y-1">
              {g.rows.map(([a, k]) => (
                <div key={a} className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="text-ink-200">{a}</span>
                  <Kbd>{k}</Kbd>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  )
}

// --- About -------------------------------------------------------------------------------

function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="About" onClose={onClose} width={360}>
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <Logo size={44} />
        <div>
          <div className="text-[15px] font-semibold tracking-tight">SFA Studio</div>
          <div className="font-mono text-[11px] text-ink-400">v{bridge?.version ?? __APP_VERSION__}</div>
        </div>
        <p className="max-w-64 text-ink-300">Free, open-source photo editor. Made by SFA — Software For All. MIT license.</p>
        <div className="flex gap-2">
          <Btn onClick={() => openUrl('https://github.com/bbeaudroit/sfa-studio')}>GitHub</Btn>
          <Btn onClick={() => openUrl('https://sforall.vercel.app')}>sforall.vercel.app</Btn>
        </div>
      </div>
    </Modal>
  )
}
