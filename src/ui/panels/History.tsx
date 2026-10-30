import { History as HistoryIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { jumpTo, useStore } from '../../core/store'
import { cx } from '../kit'

export function HistoryPanel() {
  const history = useStore(s => s.history)
  const idx = useStore(s => s.hIndex)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.querySelector('[data-current]')?.scrollIntoView({ block: 'nearest' })
  }, [idx, history.length])
  return (
    <div ref={end} className="min-h-0 flex-1 space-y-px overflow-y-auto p-1.5">
      {history.map((h, i) => (
        <button
          key={h.id}
          type="button"
          data-current={i === idx ? '' : undefined}
          onClick={() => jumpTo(i)}
          className={cx(
            'flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] transition-colors',
            i === idx ? 'bg-white/[.07] text-white' : i > idx ? 'text-ink-400 hover:bg-white/[.03]' : 'text-ink-200 hover:bg-white/[.04]',
          )}
        >
          <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', i === idx ? 'bg-lime' : i > idx ? 'bg-ink-500' : 'bg-ink-300')} />
          <span className="truncate">{h.label}</span>
          {i === 0 && <HistoryIcon size={11} className="ml-auto text-ink-400" />}
        </button>
      ))}
    </div>
  )
}
