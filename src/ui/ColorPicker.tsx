import { useEffect, useRef, useState } from 'react'
import { Pipette } from 'lucide-react'
import { S, set } from '../core/store'
import { cx, capture } from './kit'

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6)
  const n = parseInt(v, 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, max ? d / max : 0, max]
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255
  }
  return [f(5), f(3), f(1)]
}

const SWATCHES = ['#000000', '#ffffff', '#C6FF3D', '#ff4d4d', '#ff9f1c', '#ffd60a', '#2ec4b6', '#3a86ff', '#8338ec', '#ff006e', '#8d99ae', '#2b2d42']

export function ColorPicker({ value, onChange, onDone }: { value: string; onChange: (hex: string) => void; onDone?: (hex: string) => void }) {
  const [hsv, setHsv] = useState(() => rgbToHsv(...hexToRgb(value)))
  const [hex, setHex] = useState(value)
  const sv = useRef<HTMLDivElement>(null)
  const hue = useRef<HTMLDivElement>(null)
  const last = useRef(value)

  useEffect(() => {
    if (value.toLowerCase() !== last.current.toLowerCase()) {
      setHsv(rgbToHsv(...hexToRgb(value)))
      setHex(value)
      last.current = value
    }
  }, [value])

  const emit = (h: number, s: number, v: number) => {
    setHsv([h, s, v])
    const x = rgbToHex(...hsvToRgb(h, s, v))
    last.current = x
    setHex(x)
    onChange(x)
  }

  const drag = (ref: React.RefObject<HTMLDivElement | null>, fn: (fx: number, fy: number) => void) => (e: React.PointerEvent) => {
    const el = ref.current
    if (!el) return
    capture(el, e.pointerId)
    const step = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect()
      fn(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)))
    }
    step(e)
    const mv = (ev: PointerEvent) => step(ev)
    const up = () => {
      el.removeEventListener('pointermove', mv)
      el.removeEventListener('pointerup', up)
      onDone?.(last.current)
    }
    el.addEventListener('pointermove', mv)
    el.addEventListener('pointerup', up)
  }

  const [h, s, v] = hsv
  const eyeDropper = 'EyeDropper' in window

  return (
    <div className="w-60 space-y-3">
      <div
        ref={sv}
        className="relative h-36 cursor-crosshair touch-none rounded-lg"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h} 100% 50%))` }}
        onPointerDown={drag(sv, (fx, fy) => emit(h, fx, 1 - fy))}
      >
        <div className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.5)]" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: hex }} />
      </div>
      <div
        ref={hue}
        className="relative h-3 cursor-pointer touch-none rounded-full"
        style={{ background: 'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }}
        onPointerDown={drag(hue, fx => emit(fx * 360, s, v))}
      >
        <div className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.5)]" style={{ left: `${(h / 360) * 100}%`, background: `hsl(${h} 100% 50%)` }} />
      </div>
      <div className="flex items-center gap-2">
        <div className="checker h-7 w-7 shrink-0 overflow-hidden rounded-md border border-white/10"><div className="h-full w-full" style={{ background: hex }} /></div>
        <input
          className="num flex-1 uppercase"
          value={hex}
          onChange={e => {
            setHex(e.target.value)
            if (/^#?[0-9a-f]{6}$/i.test(e.target.value)) {
              const x = e.target.value.startsWith('#') ? e.target.value : '#' + e.target.value
              setHsv(rgbToHsv(...hexToRgb(x)))
              last.current = x
              onChange(x)
            }
          }}
          onBlur={() => onDone?.(last.current)}
          onKeyDown={e => e.stopPropagation()}
        />
        {eyeDropper && (
          <button
            type="button"
            data-tip="Pick from screen"
            className="grid h-7 w-7 place-items-center rounded-md text-ink-200 hover:bg-white/8"
            onClick={async () => {
              try {
                const r = await new (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper().open()
                const x = r.sRGBHex
                setHsv(rgbToHsv(...hexToRgb(x)))
                setHex(x)
                last.current = x
                onChange(x)
                onDone?.(x)
              } catch { /* cancelled */ }
            }}
          >
            <Pipette size={14} />
          </button>
        )}
      </div>
      <div className="grid grid-cols-12 gap-1">
        {[...new Set([...S().recentColors, ...SWATCHES])].slice(0, 12).map(c => (
          <button
            key={c}
            type="button"
            aria-label={c}
            className={cx('aspect-square rounded-[5px] border transition-transform hover:scale-110', c.toLowerCase() === hex.toLowerCase() ? 'border-lime' : 'border-white/10')}
            style={{ background: c }}
            onClick={() => {
              setHsv(rgbToHsv(...hexToRgb(c)))
              setHex(c)
              last.current = c
              onChange(c)
              onDone?.(c)
            }}
          />
        ))}
      </div>
    </div>
  )
}

export function rememberColor(c: string) {
  set(s => ({ recentColors: [c, ...s.recentColors.filter(x => x.toLowerCase() !== c.toLowerCase())].slice(0, 6) }))
}

/** A swatch button that opens a picker popover. */
export function ColorSwatch({ value, onChange, onDone, tip, className, size = 22 }: {
  value: string | null; onChange: (hex: string) => void; onDone?: (hex: string) => void; tip?: string; className?: string; size?: number
}) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <>
      <button
        ref={btn}
        type="button"
        data-tip={tip}
        aria-label={tip}
        className={cx('checker shrink-0 overflow-hidden rounded-md border border-white/15 transition-transform hover:scale-105', className)}
        style={{ width: size, height: size }}
        onClick={() => {
          const r = btn.current!.getBoundingClientRect()
          const x = Math.min(window.innerWidth - 270, r.left)
          const y = r.bottom + 300 > window.innerHeight ? Math.max(8, r.top - 290) : r.bottom + 6
          setPos({ x, y })
          setOpen(o => !o)
        }}
      >
        <div className="h-full w-full" style={{ background: value ?? 'transparent' }} />
        {!value && <div className="-mt-[50%] h-px w-[140%] origin-left rotate-45 bg-red-500" />}
      </button>
      {open && (
        <div ref={pop} className="fixed z-[60] animate-pop rounded-xl border border-white/10 bg-ink-800 p-3 shadow-2xl shadow-black/70" style={{ left: pos.x, top: pos.y }}>
          <ColorPicker value={value ?? '#000000'} onChange={onChange} onDone={c => { rememberColor(c); onDone?.(c) }} />
        </div>
      )}
    </>
  )
}
