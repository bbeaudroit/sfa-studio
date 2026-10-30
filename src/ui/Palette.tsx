import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { COMMANDS, TOOL_DEFS, run } from '../commands'
import { S, set, useStore } from '../core/store'
import { Kbd, cx } from './kit'
import { ToolIcon } from './Toolbar'

interface Item {
  id: string
  label: string
  keys?: string
  group: string
  tool?: (typeof TOOL_DEFS)[number]['id']
  go: () => void
}

/** Subsequence match; lower score is better, null when no match. */
function score(q: string, text: string): number | null {
  const t = text.toLowerCase()
  const i = t.indexOf(q)
  if (i >= 0) return i === 0 ? 0 : 1 + i / 100
  let pos = 0, gaps = 0
  for (const ch of q) {
    const j = t.indexOf(ch, pos)
    if (j < 0) return null
    gaps += j - pos
    pos = j + 1
  }
  return 5 + gaps
}

export function CommandPalette() {
  const open = useStore(s => s.palette)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      requestAnimationFrame(() => input.current?.focus())
    }
  }, [open])

  const items = useMemo<Item[]>(() => {
    const cmds = Object.values(COMMANDS)
      .filter(c => c.id !== 'redoAlt' && c.id !== 'palette')
      .map(c => ({ id: c.id, label: c.label.replace('…', ''), keys: c.keys, group: c.id.startsWith('adj:') ? 'Adjustment' : 'Command', go: () => run(c.id) }))
    const tools = TOOL_DEFS.filter(t => t.id !== 'transform').map(t => ({ id: `tool:${t.id}`, label: t.label, keys: t.key, group: 'Tool', tool: t.id, go: () => S().doc && set({ tool: t.id }) }))
    return [...tools, ...cmds]
  }, [])

  const results = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return items.slice(0, 40)
    return items
      .map(it => ({ it, s: score(t, `${it.label} ${it.group}`) }))
      .filter(r => r.s !== null)
      .sort((a, b) => a.s! - b.s!)
      .slice(0, 40)
      .map(r => r.it)
  }, [q, items])

  useEffect(() => {
    list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  if (!open) return null
  const close = () => set({ palette: false })
  const choose = (it?: Item) => {
    if (!it) return
    close()
    setTimeout(it.go)
  }
  const enabled = (it: Item) => {
    const c = COMMANDS[it.id]
    return it.tool ? !!S().doc : !c?.enabled || c.enabled()
  }

  return (
    <div className="fixed inset-0 z-[95] flex animate-fade justify-center bg-black/40 pt-[14vh]" onPointerDown={e => e.target === e.currentTarget && close()}>
      <div className="h-fit w-[520px] animate-pop overflow-hidden rounded-2xl border border-white/10 bg-ink-850 shadow-2xl shadow-black/70">
        <div className="flex items-center gap-2 border-b border-white/6 px-3">
          <Search size={15} className="text-ink-400" />
          <input
            ref={input}
            value={q}
            placeholder="Search tools and commands"
            className="h-11 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-ink-500"
            onChange={e => { setQ(e.target.value); setSel(0) }}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Escape') close()
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(results.length - 1, s + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)) }
              else if (e.key === 'Enter') choose(results[sel])
            }}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={list} className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 && <div className="px-3 py-6 text-center text-ink-400">No match</div>}
          {results.map((it, i) => {
            const on = enabled(it)
            return (
              <button
                key={it.id}
                type="button"
                data-i={i}
                disabled={!on}
                onPointerMove={() => setSel(i)}
                onClick={() => choose(it)}
                className={cx('flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[12.5px] disabled:opacity-35', i === sel ? 'bg-lime text-ink-950' : 'text-ink-100')}
              >
                <span className={cx('grid h-5 w-5 shrink-0 place-items-center', i === sel ? 'text-ink-950' : 'text-ink-300')}>
                  {it.tool ? <ToolIcon id={it.tool} size={14} /> : <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />}
                </span>
                <span className="flex-1 truncate">{it.label}</span>
                <span className={cx('text-[10.5px]', i === sel ? 'text-ink-950/60' : 'text-ink-500')}>{it.group}</span>
                {it.keys && <span className={cx('font-mono text-[10.5px]', i === sel ? 'text-ink-950/70' : 'text-ink-400')}>{it.keys}</span>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
