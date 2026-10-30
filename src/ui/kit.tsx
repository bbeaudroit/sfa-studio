import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

/** Tooltips come from data-tip / data-key attributes, rendered once at the root. */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; key?: string; x: number; y: number; side: 'right' | 'bottom' | 'top' } | null>(null)
  useEffect(() => {
    let timer = 0
    let current: HTMLElement | null = null
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null
      if (el === current) return
      current = el
      clearTimeout(timer)
      setTip(null)
      if (!el) return
      timer = window.setTimeout(() => {
        const r = el.getBoundingClientRect()
        const side = (el.dataset.side as 'right' | 'bottom' | 'top') ?? 'bottom'
        const x = side === 'right' ? r.right + 8 : r.left + r.width / 2
        const y = side === 'right' ? r.top + r.height / 2 : side === 'top' ? r.top - 8 : r.bottom + 8
        setTip({ text: el.dataset.tip!, key: el.dataset.key, x, y, side })
      }, 420)
    }
    const hide = () => { clearTimeout(timer); current = null; setTip(null) }
    document.addEventListener('mouseover', over)
    document.addEventListener('mousedown', hide)
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('mouseover', over)
      document.removeEventListener('mousedown', hide)
      window.removeEventListener('blur', hide)
    }
  }, [])
  if (!tip) return null
  const style: React.CSSProperties =
    tip.side === 'right'
      ? { left: tip.x, top: tip.y, transform: 'translateY(-50%)' }
      : tip.side === 'top'
        ? { left: tip.x, top: tip.y, transform: 'translate(-50%, -100%)' }
        : { left: tip.x, top: tip.y, transform: 'translateX(-50%)' }
  return (
    <div className="pointer-events-none fixed z-[100] flex animate-fade items-center gap-2 rounded-lg border border-white/10 bg-ink-800/95 px-2 py-1 text-[11.5px] whitespace-nowrap text-ink-100 shadow-xl shadow-black/50 backdrop-blur" style={style}>
      {tip.text}
      {tip.key && <Kbd>{tip.key}</Kbd>}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="rounded-[5px] border border-white/10 bg-white/5 px-1 font-mono text-[10.5px] text-ink-200">{children}</span>
}

export function IconBtn({ icon, tip, k, onClick, active, disabled, side, className, size = 'md' }: {
  icon: ReactNode; tip: string; k?: string; onClick?: () => void; active?: boolean; disabled?: boolean
  side?: 'right' | 'bottom' | 'top'; className?: string; size?: 'sm' | 'md'
}) {
  return (
    <button
      type="button"
      data-tip={tip}
      data-key={k}
      data-side={side}
      aria-label={tip}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'grid shrink-0 place-items-center rounded-lg transition-colors duration-100 disabled:opacity-30',
        size === 'sm' ? 'h-6 w-6' : 'h-8 w-8',
        active ? 'bg-lime text-ink-950' : 'text-ink-200 hover:bg-white/8 hover:text-white',
        className,
      )}
    >
      {icon}
    </button>
  )
}

export function Btn({ children, onClick, primary, disabled, className, type = 'button' }: {
  children: ReactNode; onClick?: () => void; primary?: boolean; disabled?: boolean; className?: string; type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition-all duration-100 active:scale-[.97] disabled:opacity-40',
        primary ? 'bg-lime text-ink-950 hover:bg-[#d4ff6a]' : 'border border-white/10 bg-white/[.04] text-ink-100 hover:bg-white/[.08]',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Slider({ label, value, min, max, step = 1, onChange, onCommit, unit = '', format, className, wide }: {
  label?: string; value: number; min: number; max: number; step?: number
  onChange: (v: number) => void; onCommit?: () => void; unit?: string; format?: (v: number) => string; className?: string; wide?: boolean
}) {
  const p = ((value - min) / (max - min)) * 100
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className={cx('flex items-center gap-2', className)}>
      {label && <span className={cx('shrink-0 text-ink-300', wide ? 'w-20' : '')}>{label}</span>}
      <input
        type="range"
        className="slider min-w-16 flex-1"
        style={{ '--p': `${p}%` } as React.CSSProperties}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
      <input
        className="num w-14 shrink-0 px-1.5 text-right"
        value={draft ?? (format ? format(value) : `${+value.toFixed(2)}${unit}`)}
        onFocus={e => { setDraft(String(+value.toFixed(2))); setTimeout(() => e.target.select()) }}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          const v = parseFloat(draft ?? '')
          if (!Number.isNaN(v)) { onChange(Math.min(max, Math.max(min, v))); onCommit?.() }
          setDraft(null)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur() }
          e.stopPropagation()
        }}
      />
    </label>
  )
}

export function Segmented<T extends string>({ value, options, onChange, className }: {
  value: T; options: { id: T; label?: string; icon?: ReactNode; tip?: string }[]; onChange: (v: T) => void; className?: string
}) {
  return (
    <div className={cx('flex h-7 items-center rounded-lg border border-white/8 bg-ink-850 p-0.5', className)}>
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          data-tip={o.tip}
          aria-label={o.tip ?? o.label}
          onClick={() => onChange(o.id)}
          className={cx(
            'flex h-full min-w-6 items-center justify-center gap-1 rounded-md px-2 text-[11.5px] transition-colors',
            value === o.id ? 'bg-ink-600 text-white shadow-sm' : 'text-ink-300 hover:text-white',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Check({ label, checked, onChange, tip }: { label: string; checked: boolean; onChange: (v: boolean) => void; tip?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-ink-200" data-tip={tip}>
      <span className={cx('grid h-3.5 w-3.5 place-items-center rounded-[4px] border transition-colors', checked ? 'border-lime bg-lime' : 'border-ink-400 bg-transparent')}>
        {checked && <svg viewBox="0 0 10 10" className="h-2.5 w-2.5"><path d="M2 5.2 4.2 7.4 8 2.8" fill="none" stroke="#070708" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </span>
      <input type="checkbox" className="sr-only" checked={checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

export function Select<T extends string>({ value, options, onChange, className, tip }: {
  value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; className?: string; tip?: string
}) {
  return (
    <select
      data-tip={tip}
      value={value}
      onChange={e => onChange(e.target.value as T)}
      className={cx('h-7 rounded-lg border border-white/8 bg-ink-800 px-2 text-[12px] text-ink-100 outline-none hover:border-white/15 focus:border-lime', className)}
    >
      {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  )
}

export function Modal({ title, onClose, children, footer, width = 420 }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', k, true)
    ref.current?.querySelector<HTMLElement>('input,select,button[data-autofocus]')?.focus()
    return () => window.removeEventListener('keydown', k, true)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 grid animate-fade place-items-center bg-black/55 backdrop-blur-[2px]" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="animate-pop overflow-hidden rounded-2xl border border-white/10 bg-ink-850 shadow-2xl shadow-black/70" style={{ width }} onKeyDown={e => e.stopPropagation()}>
        <div className="flex h-11 items-center justify-between border-b border-white/6 pr-2 pl-4">
          <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
          <IconBtn icon={<X size={15} />} tip="Close" k="Esc" onClick={onClose} size="sm" />
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-white/6 bg-ink-900/50 px-4 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function NumField({ label, value, onChange, min = -1e6, max = 1e6, suffix, className }: {
  label?: string; value: number; onChange: (v: number) => void; min?: number; max?: number; suffix?: string; className?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className={cx('flex items-center gap-1.5', className)}>
      {label && <span className="w-4 shrink-0 text-[11px] text-ink-300">{label}</span>}
      <div className="relative min-w-0 flex-1">
        <input
          className="num w-full pr-6"
          value={draft ?? String(Math.round(value * 100) / 100)}
          onFocus={e => { setDraft(String(Math.round(value * 100) / 100)); setTimeout(() => e.target.select()) }}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => {
            const v = parseFloat(draft ?? '')
            if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)))
            setDraft(null)
          }}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              const v = Math.min(max, Math.max(min, value + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)))
              onChange(v)
              setDraft(String(v))
            }
          }}
        />
        {suffix && <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10.5px] text-ink-400">{suffix}</span>}
      </div>
    </label>
  )
}

/** setPointerCapture throws for synthetic/stale pointers; never let that break a drag. */
export function capture(el: Element, id: number) {
  try {
    el.setPointerCapture(id)
  } catch { /* ignore */ }
}
