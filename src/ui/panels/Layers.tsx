import { Copy, Eye, EyeOff, FolderDown, Layers2, Lock, LockOpen, Plus, SlidersHorizontal, Trash2, Type } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { ADJUSTMENTS } from '../../core/adjustments'
import { addAdjustment, addLayer, deleteLayer, duplicateLayer, mergeDown, moveLayer, selectLayer, selectLayerPixels } from '../../core/ops'
import { layerSource } from '../../core/render'
import { S, commit, set, updateLayer, useStore } from '../../core/store'
import { BLEND_MODES, type BlendMode, type Layer } from '../../core/types'
import { IconBtn, Select, Slider, cx } from '../kit'

function Thumb({ layer }: { layer: Layer }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const ver = useStore(s => s.ver)
  const dw = useStore(s => s.doc?.width ?? 1)
  const dh = useStore(s => s.doc?.height ?? 1)
  useEffect(() => {
    const t = setTimeout(() => {
      const c = ref.current
      if (!c) return
      const g = c.getContext('2d')!
      g.clearRect(0, 0, c.width, c.height)
      const s = layerSource(layer)
      if (!s) return
      const k = Math.min(c.width / dw, c.height / dh)
      const ox = (c.width - dw * k) / 2, oy = (c.height - dh * k) / 2
      g.save()
      g.beginPath()
      g.rect(ox, oy, dw * k, dh * k)
      g.clip()
      g.imageSmoothingQuality = 'high'
      g.drawImage(s.src, ox + s.x * k, oy + s.y * k, s.src.width * k, s.src.height * k)
      g.restore()
    }, 60)
    return () => clearTimeout(t)
  }, [layer, ver, dw, dh])
  if (layer.kind === 'adjust') {
    return (
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-white/10 bg-ink-700 text-ink-200">
        <SlidersHorizontal size={15} />
      </div>
    )
  }
  return (
    <div className="checker-dark relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-white/10">
      <canvas ref={ref} width={72} height={72} className="h-full w-full" />
      {layer.kind === 'text' && <Type size={10} className="absolute right-0.5 bottom-0.5 rounded-sm bg-ink-900 text-lime" />}
    </div>
  )
}

const Row = memo(function Row({ layer, active, index, onDragStart, dropHint }: {
  layer: Layer; active: boolean; index: number
  onDragStart: (e: React.DragEvent, index: number) => void
  dropHint: 'above' | 'below' | null
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(layer.name)
  useEffect(() => setName(layer.name), [layer.name])
  return (
    <div
      draggable={!editing}
      onDragStart={e => onDragStart(e, index)}
      data-index={index}
      onPointerDown={e => {
        if ((e.target as HTMLElement).closest('button,input')) return
        if (e.ctrlKey || e.metaKey) selectLayerPixels(layer.id)
        else if (!active) selectLayer(layer.id)
      }}
      onDoubleClick={e => { if (!(e.target as HTMLElement).closest('button')) setEditing(true) }}
      className={cx(
        'group relative flex h-12 cursor-default items-center gap-2.5 rounded-lg px-2 transition-colors',
        active ? 'bg-white/[.07] ring-1 ring-lime/50' : 'hover:bg-white/[.04]',
        !layer.visible && 'opacity-50',
      )}
    >
      {dropHint && <div className={cx('pointer-events-none absolute right-1 left-1 h-0.5 rounded-full bg-lime', dropHint === 'above' ? '-top-px' : '-bottom-px')} />}
      <button
        type="button"
        data-tip={layer.visible ? 'Hide' : 'Show'}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-300 hover:bg-white/8 hover:text-white"
        onClick={() => updateLayer(layer.id, { visible: !layer.visible }, layer.visible ? 'Hide layer' : 'Show layer')}
      >
        {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
      <Thumb layer={layer} />
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            className="num h-6 w-full font-sans"
            value={name}
            onChange={e => setName(e.target.value)}
            onFocus={e => e.target.select()}
            onBlur={() => {
              setEditing(false)
              if (name.trim() && name !== layer.name) updateLayer(layer.id, { name: name.trim() }, 'Rename layer')
            }}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') { setName(layer.name); setEditing(false) }
            }}
          />
        ) : (
          <div className="truncate text-[12.5px] text-ink-100">{layer.name}</div>
        )}
        <div className="truncate text-[10.5px] text-ink-400">
          {layer.kind === 'adjust' ? 'Adjustment' : layer.kind === 'text' ? 'Text' : layer.kind === 'shape' ? 'Shape' : 'Pixels'}
          {layer.blend !== 'source-over' && ` · ${BLEND_MODES.find(b => b.id === layer.blend)?.label}`}
          {layer.opacity < 1 && ` · ${Math.round(layer.opacity * 100)}%`}
        </div>
      </div>
      <button
        type="button"
        data-tip={layer.locked ? 'Unlock' : 'Lock'}
        className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-md hover:bg-white/8', layer.locked ? 'text-lime' : 'text-ink-400 opacity-0 group-hover:opacity-100')}
        onClick={() => updateLayer(layer.id, { locked: !layer.locked }, layer.locked ? 'Unlock layer' : 'Lock layer')}
      >
        {layer.locked ? <Lock size={13} /> : <LockOpen size={13} />}
      </button>
    </div>
  )
})

export function LayersPanel() {
  const doc = useStore(s => s.doc)
  const active = doc?.layers.find(l => l.id === doc.activeId)
  const [drag, setDrag] = useState<{ from: number; over: number | null; after: boolean } | null>(null)
  const [adjOpen, setAdjOpen] = useState(false)
  const opacityStart = useRef<number | null>(null)

  if (!doc) return <div className="p-4 text-ink-400">No document</div>
  const rows = [...doc.layers].map((l, i) => ({ l, i })).reverse()

  const onDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/x-sfa-layer', String(index))
    setDrag({ from: index, over: null, after: false })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {active && (
        <div className="space-y-2 border-b border-white/6 px-3 pt-1 pb-3">
          <div className="flex items-center gap-2">
            <Select
              value={active.blend}
              onChange={v => updateLayer(active.id, { blend: v as BlendMode }, 'Blend mode')}
              options={BLEND_MODES.map(b => ({ id: b.id, label: b.label }))}
              className={cx('flex-1', active.kind === 'adjust' && 'opacity-40')}
              tip="Blend mode"
            />
          </div>
          <Slider
            label="Opacity"
            value={Math.round(active.opacity * 100)}
            min={0}
            max={100}
            unit="%"
            onChange={v => {
              if (opacityStart.current === null) opacityStart.current = active.opacity
              updateLayer(active.id, { opacity: v / 100 })
            }}
            onCommit={() => {
              if (opacityStart.current !== null && opacityStart.current !== S().doc?.layers.find(l => l.id === active.id)?.opacity) commit('Opacity')
              opacityStart.current = null
            }}
          />
        </div>
      )}
      <div
        className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5"
        onDragOver={e => {
          if (!drag) return
          e.preventDefault()
          const row = (e.target as HTMLElement).closest('[data-index]') as HTMLElement | null
          if (!row) return
          const r = row.getBoundingClientRect()
          const idx = Number(row.dataset.index)
          const above = e.clientY < r.top + r.height / 2
          setDrag(d => d && { ...d, over: idx, after: above })
        }}
        onDrop={e => {
          e.preventDefault()
          if (!drag || drag.over === null) return setDrag(null)
          const l = doc.layers[drag.from]
          // Visual list is top-first; "above" in the list = higher index.
          let to = drag.after ? drag.over + 1 : drag.over
          if (drag.from < to) to--
          setDrag(null)
          moveLayer(l.id, to)
        }}
        onDragEnd={() => setDrag(null)}
      >
        {rows.map(({ l, i }) => (
          <Row
            key={l.id}
            layer={l}
            index={i}
            active={l.id === doc.activeId}
            onDragStart={onDragStart}
            dropHint={drag && drag.over === i && drag.from !== i ? (drag.after ? 'above' : 'below') : null}
          />
        ))}
      </div>
      <div className="relative flex items-center gap-0.5 border-t border-white/6 px-2 py-1.5">
        <IconBtn icon={<Plus size={15} />} tip="New layer" k="Ctrl+Shift+N" side="top" onClick={addLayer} size="sm" className="h-7 w-7" />
        <IconBtn icon={<SlidersHorizontal size={15} />} tip="Adjustment layer" side="top" onClick={() => setAdjOpen(o => !o)} active={adjOpen} size="sm" className="h-7 w-7" />
        <IconBtn icon={<Copy size={14} />} tip="Duplicate" k="Ctrl+J" side="top" onClick={duplicateLayer} size="sm" className="h-7 w-7" />
        <IconBtn icon={<FolderDown size={15} />} tip="Merge down" k="Ctrl+E" side="top" onClick={mergeDown} size="sm" className="h-7 w-7" />
        <div className="flex-1" />
        <span className="pr-1 font-mono text-[10.5px] text-ink-400"><Layers2 size={11} className="mr-1 inline" />{doc.layers.length}</span>
        <IconBtn icon={<Trash2 size={14} />} tip="Delete layer" side="top" onClick={() => deleteLayer()} size="sm" className="h-7 w-7 hover:!text-red-400" />
        {adjOpen && (
          <div className="absolute bottom-full left-2 z-30 mb-1 w-52 animate-pop rounded-xl border border-white/10 bg-ink-800 p-1 shadow-2xl shadow-black/60" onMouseLeave={() => setAdjOpen(false)}>
            {ADJUSTMENTS.map(a => (
              <button
                key={a.type}
                type="button"
                className="flex h-7 w-full items-center justify-between rounded-md px-2 text-left text-[12px] text-ink-100 hover:bg-lime hover:text-ink-950"
                onClick={() => { addAdjustment(a.type); setAdjOpen(false) }}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function setActiveLayerOpacity(v: number) {
  const d = S().doc
  if (!d?.activeId) return
  updateLayer(d.activeId, { opacity: v }, 'Opacity')
  set({})
}
