import { create } from 'zustand'
import { ctx2d } from './bitmap'
import type { Preview } from './render'
import type { Bitmap, Doc, Layer, Rect } from './types'

export type ToolId =
  | 'move' | 'marquee' | 'lasso' | 'wand' | 'crop' | 'eyedropper'
  | 'brush' | 'eraser' | 'bucket' | 'gradient' | 'text' | 'shape' | 'hand' | 'zoom'

export interface Patch {
  bmp: Bitmap
  rect: Rect
  before: ImageData
  after: ImageData
}

export interface HistoryEntry {
  id: number
  label: string
  doc: Doc
  patches: Patch[]
}

export interface ToolOptions {
  brush: { size: number; hardness: number; opacity: number }
  eraser: { size: number; hardness: number; opacity: number }
  marquee: { shape: 'rect' | 'ellipse'; feather: number; mode: 'new' | 'add' | 'subtract' | 'intersect' }
  lasso: { poly: boolean; feather: number; mode: 'new' | 'add' | 'subtract' | 'intersect' }
  wand: { tolerance: number; contiguous: boolean; sampleAll: boolean; mode: 'new' | 'add' | 'subtract' | 'intersect' }
  bucket: { tolerance: number; contiguous: boolean; sampleAll: boolean }
  gradient: { type: 'linear' | 'radial'; toTransparent: boolean }
  crop: { aspect: string; deleteCropped: boolean }
  text: { font: string; size: number; weight: number; align: 'left' | 'center' | 'right' }
  shape: { shape: 'rect' | 'ellipse' | 'line'; fill: boolean; stroke: boolean; strokeWidth: number; radius: number }
  move: { autoSelect: boolean }
}

export type DialogId =
  | null | 'new' | 'export' | 'imageSize' | 'canvasSize' | 'shortcuts' | 'about'
  | { filter: 'blur' | 'sharpen' | 'noise' }

export interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

export interface View {
  zoom: number
  panX: number
  panY: number
}

interface State {
  doc: Doc | null
  docName: string
  docPath: string | null
  savedId: number
  history: HistoryEntry[]
  hIndex: number
  /** Bumped when bitmap pixels change in place. */
  ver: number
  preview: Preview | null
  overlayVer: number

  tool: ToolId
  opts: ToolOptions
  fg: string
  bg: string

  view: View
  viewport: { w: number; h: number }
  cursor: { x: number; y: number } | null
  rulers: boolean
  showGuides: boolean
  dialog: DialogId
  textEditId: string | null
  toasts: Toast[]
  recentColors: string[]
}

const DEFAULT_OPTS: ToolOptions = {
  brush: { size: 24, hardness: 0.85, opacity: 1 },
  eraser: { size: 40, hardness: 0.9, opacity: 1 },
  marquee: { shape: 'rect', feather: 0, mode: 'new' },
  lasso: { poly: false, feather: 0, mode: 'new' },
  wand: { tolerance: 32, contiguous: true, sampleAll: true, mode: 'new' },
  bucket: { tolerance: 32, contiguous: true, sampleAll: false },
  gradient: { type: 'linear', toTransparent: false },
  crop: { aspect: 'free', deleteCropped: true },
  text: { font: 'Geist Variable', size: 72, weight: 600, align: 'left' },
  shape: { shape: 'rect', fill: true, stroke: false, strokeWidth: 6, radius: 0 },
  move: { autoSelect: true },
}

function loadOpts(): ToolOptions {
  try {
    const raw = localStorage.getItem('sfa.studio.opts')
    if (raw) {
      const saved = JSON.parse(raw)
      const merged = { ...DEFAULT_OPTS } as Record<string, object>
      for (const k of Object.keys(DEFAULT_OPTS)) merged[k] = { ...(DEFAULT_OPTS as unknown as Record<string, object>)[k], ...saved[k] }
      return merged as unknown as ToolOptions
    }
  } catch { /* fresh start */ }
  return DEFAULT_OPTS
}

export const useStore = create<State>(() => ({
  doc: null,
  docName: 'Untitled',
  docPath: null,
  savedId: 0,
  history: [],
  hIndex: -1,
  ver: 0,
  preview: null,
  overlayVer: 0,
  tool: 'move',
  opts: loadOpts(),
  fg: '#C6FF3D',
  bg: '#0B0B0C',
  view: { zoom: 1, panX: 0, panY: 0 },
  viewport: { w: 800, h: 600 },
  cursor: null,
  rulers: true,
  showGuides: true,
  dialog: null,
  textEditId: null,
  toasts: [],
  recentColors: [],
}))

export const S = () => useStore.getState()
export const set = useStore.setState

let saveTimer = 0
useStore.subscribe((s, p) => {
  if (s.opts !== p.opts) {
    clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      try { localStorage.setItem('sfa.studio.opts', JSON.stringify(s.opts)) } catch { /* ignore */ }
    }, 300)
  }
})

export function setOpt<K extends keyof ToolOptions>(tool: K, patch: Partial<ToolOptions[K]>) {
  set(s => ({ opts: { ...s.opts, [tool]: { ...s.opts[tool], ...patch } } }))
}

export const bump = () => set(s => ({ ver: s.ver + 1 }))
export const redrawOverlay = () => set(s => ({ overlayVer: s.overlayVer + 1 }))

// --- Toasts ---------------------------------------------------------------

let toastId = 0
export function toast(text: string, action?: Toast['action'], ms = 3200) {
  const id = ++toastId
  set(s => ({ toasts: [...s.toasts.slice(-2), { id, text, action }] }))
  setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), ms)
}

// --- Document + history ---------------------------------------------------

let entryId = 0
const MAX_HISTORY = 60
const MAX_BYTES = 1.2e9

export function activeLayer(): Layer | null {
  const d = S().doc
  return d?.layers.find(l => l.id === d.activeId) ?? null
}

/** Replace the document without recording history (live edits). */
export function setDocSilent(doc: Doc) {
  set({ doc })
}

/** Update the document, optionally recording a history step. */
export function updateDoc(fn: (d: Doc) => Doc, label?: string) {
  const d = S().doc
  if (!d) return
  set({ doc: fn(d) })
  if (label) commit(label)
}

export function updateLayer(id: string, patch: Partial<Layer>, label?: string) {
  updateDoc(d => ({ ...d, layers: d.layers.map(l => (l.id === id ? ({ ...l, ...patch } as Layer) : l)) }), label)
}

function patchBytes(e: HistoryEntry) {
  return e.patches.reduce((n, p) => n + p.before.data.length * 2, 0)
}

/** Record the current doc (and optional pixel patches) as a new history step. */
export function commit(label: string, patches: Patch[] = []) {
  const s = S()
  if (!s.doc) return
  let history = s.history.slice(0, s.hIndex + 1)
  history.push({ id: ++entryId, label, doc: s.doc, patches })
  let bytes = history.reduce((n, e) => n + patchBytes(e), 0)
  while (history.length > MAX_HISTORY || (bytes > MAX_BYTES && history.length > 2)) {
    bytes -= patchBytes(history[1])
    // Fold the oldest step into the base snapshot.
    history = [{ ...history[1], patches: [] }, ...history.slice(2)]
  }
  set({ history, hIndex: history.length - 1, ver: s.ver + (patches.length ? 1 : 0) })
}

/** Start a fresh document with a single history entry. */
export function loadDoc(doc: Doc, name: string, path: string | null, label = 'Open') {
  const id = ++entryId
  set({
    doc,
    docName: name,
    docPath: path,
    history: [{ id, label, doc, patches: [] }],
    hIndex: 0,
    savedId: id,
    preview: null,
    textEditId: null,
    ver: S().ver + 1,
  })
}

export function closeDoc() {
  set({ doc: null, history: [], hIndex: -1, preview: null, textEditId: null, docPath: null, docName: 'Untitled' })
}

function applyPatches(patches: Patch[], which: 'before' | 'after') {
  const list = which === 'before' ? [...patches].reverse() : patches
  for (const p of list) ctx2d(p.bmp.canvas).putImageData(p[which], p.rect.x, p.rect.y)
}

export function undo() {
  const s = S()
  if (!s.doc || s.hIndex < 0) return
  const cur = s.history[s.hIndex]
  if (s.doc !== cur.doc || s.preview) {
    set({ doc: cur.doc, preview: null })
    return
  }
  if (s.hIndex === 0) return
  applyPatches(cur.patches, 'before')
  set({ hIndex: s.hIndex - 1, doc: s.history[s.hIndex - 1].doc, ver: s.ver + 1 })
}

export function redo() {
  const s = S()
  if (!s.doc || s.hIndex >= s.history.length - 1) return
  const next = s.history[s.hIndex + 1]
  applyPatches(next.patches, 'after')
  set({ hIndex: s.hIndex + 1, doc: next.doc, ver: s.ver + 1, preview: null })
}

export function jumpTo(i: number) {
  if (S().doc !== S().history[S().hIndex]?.doc) undo()
  while (S().hIndex > i) undo()
  while (S().hIndex < i) redo()
}

export function isDirty() {
  const s = S()
  return !!s.doc && s.history[s.hIndex]?.id !== s.savedId
}

export function markSaved() {
  const s = S()
  set({ savedId: s.history[s.hIndex]?.id ?? 0 })
}

/** Capture before/after pixels around an in-place bitmap edit. */
export function editPixels(bmp: Bitmap, rect: Rect | null, fn: (g: CanvasRenderingContext2D) => void): Patch | null {
  const { width: w, height: h } = bmp.canvas
  const r0 = rect ?? { x: 0, y: 0, w, h }
  const x = Math.max(0, Math.floor(r0.x)), y = Math.max(0, Math.floor(r0.y))
  const x1 = Math.min(w, Math.ceil(r0.x + r0.w)), y1 = Math.min(h, Math.ceil(r0.y + r0.h))
  const g = ctx2d(bmp.canvas)
  if (x1 <= x || y1 <= y) {
    fn(g)
    return null
  }
  const r = { x, y, w: x1 - x, h: y1 - y }
  const before = g.getImageData(r.x, r.y, r.w, r.h)
  fn(g)
  const after = g.getImageData(r.x, r.y, r.w, r.h)
  return { bmp, rect: r, before, after }
}
