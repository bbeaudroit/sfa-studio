import { useEffect, useRef } from 'react'
import { fontString, textLayout } from '../core/render'
import { S, set, useStore } from '../core/store'
import type { TextLayer } from '../core/types'
import { endTextEdit } from '../tools/tools'

/** In-canvas text editing: the layer is hidden and a styled textarea sits on top of it. */
export function TextEditor({ offset }: { offset: number }) {
  const id = useStore(s => s.textEditId)
  const layer = useStore(s => (s.textEditId ? (s.doc?.layers.find(l => l.id === s.textEditId) as TextLayer | undefined) : undefined))
  const view = useStore(s => s.view)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!id) return
    set({ preview: { layerId: id, hidden: true } })
    requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.select()
    })
    return () => set({ preview: null })
  }, [id])

  if (!id || !layer) return null
  const t = textLayout({ ...layer, text: layer.text || ' ' })
  const z = view.zoom
  const left = offset + view.panX + t.box.x * z
  const top = offset + view.panY + t.box.y * z
  const pad = 2

  const update = (text: string) => {
    const d = S().doc!
    set({
      doc: {
        ...d,
        layers: d.layers.map(l => (l.id === id ? { ...(l as TextLayer), text, name: text.split('\n')[0].slice(0, 32) || 'Text' } : l)),
      },
    })
  }

  return (
    <textarea
      ref={ref}
      value={layer.text}
      spellCheck={false}
      onChange={e => update(e.target.value)}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault()
          endTextEdit()
        }
      }}
      onBlur={() => setTimeout(() => S().textEditId === id && endTextEdit(), 0)}
      placeholder="Type…"
      className="absolute z-20 resize-none overflow-hidden border-0 bg-transparent outline outline-1 outline-dashed outline-lime/80 placeholder:text-white/30"
      style={{
        left: left - pad,
        top: top - pad,
        width: Math.max(t.w * z, layer.size * z * 2) + pad * 2 + 4,
        height: t.h * z + pad * 2,
        padding: pad,
        font: fontString(layer, z),
        lineHeight: `${layer.size * layer.lineHeight * z}px`,
        color: layer.color,
        textAlign: layer.align,
        caretColor: '#C6FF3D',
        whiteSpace: 'pre',
        opacity: layer.opacity,
        transformOrigin: layer.align === 'left' ? 'left' : layer.align === 'right' ? 'right' : 'center',
        marginLeft: layer.align === 'center' ? -(Math.max(t.w * z, layer.size * z * 2) - t.w * z) / 2 : layer.align === 'right' ? -(Math.max(t.w * z, layer.size * z * 2) - t.w * z) : 0,
      }}
    />
  )
}
