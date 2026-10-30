import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { canvasToBlob, ctx2d, loadImage, makeCanvas, uid } from './bitmap'
import { docFromImage, placeImage, pasteInternal, rasterLayer } from './ops'
import { flattenToCanvas } from './render'
import { S, isDirty, loadDoc, markSaved, set, toast } from './store'
import type { Doc, Layer } from './types'
import { bridge, baseName, dropRecent, pickFile, pushRecent, saveAs, stripExt, writeTo } from './platform'
import { fitView } from './view'

const FORMAT = 'sfa-studio'
const VERSION = 1

// --- Project (.sfas = zip of document.json + PNG layers) -------------------

async function pngBytes(c: HTMLCanvasElement) {
  return new Uint8Array(await (await canvasToBlob(c)).arrayBuffer())
}

export async function encodeProject(doc: Doc): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  const layers = await Promise.all(
    doc.layers.map(async l => {
      if (l.kind !== 'raster') return l
      const file = `layers/${l.id}.png`
      files[file] = await pngBytes(l.bmp.canvas)
      const { bmp: _bmp, ...rest } = l
      return { ...rest, file }
    }),
  )
  const flat = flattenToCanvas(doc)
  const k = Math.min(1, 512 / Math.max(doc.width, doc.height))
  const thumb = makeCanvas(doc.width * k, doc.height * k)
  ctx2d(thumb).drawImage(flat, 0, 0, thumb.width, thumb.height)
  files['preview.png'] = await pngBytes(thumb)
  const meta = { format: FORMAT, version: VERSION, width: doc.width, height: doc.height, activeId: doc.activeId, guides: doc.guides, layers }
  files['document.json'] = strToU8(JSON.stringify(meta, null, 1))
  return zipSync(files, { level: 0 }) // PNGs are already compressed
}

export async function decodeProject(data: Uint8Array): Promise<Doc> {
  const files = unzipSync(data)
  const json = files['document.json']
  if (!json) throw new Error('Not an SFA Studio project')
  const meta = JSON.parse(strFromU8(json))
  if (meta.format !== FORMAT) throw new Error('Not an SFA Studio project')
  const layers: Layer[] = await Promise.all(
    meta.layers.map(async (l: Layer & { file?: string }) => {
      if (l.kind !== 'raster') return l
      const bytes = files[l.file!]
      const img = await loadImage(new Blob([bytes as BlobPart], { type: 'image/png' }))
      const c = makeCanvas(img.width, img.height)
      ctx2d(c).drawImage(img, 0, 0)
      const { file: _f, ...rest } = l
      return { ...rest, bmp: { id: uid('bmp'), canvas: c } } as Layer
    }),
  )
  return {
    width: meta.width,
    height: meta.height,
    layers,
    activeId: meta.activeId ?? layers[layers.length - 1]?.id ?? null,
    selection: null,
    guides: meta.guides ?? { h: [], v: [] },
  }
}

// --- Open -------------------------------------------------------------------

export async function confirmDiscard(): Promise<boolean> {
  if (!isDirty()) return true
  return window.confirm('Discard unsaved changes?')
}

export async function openBytes(name: string, path: string | null, data: Uint8Array, asLayer = false) {
  try {
    if (/\.sfas$/i.test(name)) {
      if (!(await confirmDiscard())) return
      const doc = await decodeProject(data)
      loadDoc(doc, name, path)
      fitView()
    } else {
      const img = await loadImage(new Blob([data as BlobPart]))
      if (asLayer && S().doc) placeImage(img, name)
      else {
        if (!(await confirmDiscard())) return
        docFromImage(img, name, path)
      }
    }
    if (path) pushRecent(path)
  } catch (e) {
    console.error(e)
    toast(`Couldn’t open ${name}`)
  }
}

export async function openDialog() {
  const f = await pickFile()
  if (f) await openBytes(f.name, f.path, f.data)
}

export async function placeDialog() {
  const f = await pickFile([{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'] }])
  if (f) await openBytes(f.name, null, f.data, true)
}

export async function openPath(path: string) {
  if (!bridge) return
  const f = await bridge.readFile(path)
  if (!f) {
    dropRecent(path)
    toast(`Can’t find ${baseName(path)}`)
    return
  }
  await openBytes(f.name, f.path, f.data)
}

export async function openFiles(files: File[], asLayer: boolean) {
  for (const f of files) {
    if (!/^image\//.test(f.type) && !/\.sfas$/i.test(f.name)) continue
    const path = bridge?.pathForFile(f) ?? null
    await openBytes(f.name, path, new Uint8Array(await f.arrayBuffer()), asLayer && !!S().doc)
    asLayer = true
  }
}

/** Paste from the system clipboard; falls back to our own clipboard. */
export async function paste(e?: ClipboardEvent) {
  const items = e?.clipboardData?.items
  if (items) {
    for (const it of items) {
      const f = it.kind === 'file' ? it.getAsFile() : null
      if (f && f.type.startsWith('image/')) {
        const img = await loadImage(f)
        if (S().doc) placeImage(img, 'Pasted')
        else docFromImage(img, 'Pasted.png', null)
        return
      }
    }
  }
  if (await pasteInternal()) return
  try {
    for (const it of await navigator.clipboard.read()) {
      const t = it.types.find(t => t.startsWith('image/'))
      if (t) {
        const img = await loadImage(await it.getType(t))
        if (S().doc) placeImage(img, 'Pasted')
        else docFromImage(img, 'Pasted.png', null)
        return
      }
    }
  } catch { /* clipboard read not allowed */ }
  toast('Clipboard has no image')
}

// --- Save -------------------------------------------------------------------

export async function saveProject(forceDialog = false) {
  const s = S()
  if (!s.doc) return
  const data = await encodeProject(s.doc)
  const name = `${stripExt(s.docName)}.sfas`
  let path = s.docPath && /\.sfas$/i.test(s.docPath) && !forceDialog ? s.docPath : null
  if (path) {
    if (!(await writeTo(path, data))) return toast('Save failed')
  } else {
    const r = await saveAs(name, [{ name: 'SFA Studio project', extensions: ['sfas'] }], data)
    if (!r) return
    path = bridge ? r : null
    set({ docName: baseName(r), docPath: path })
  }
  if (path) pushRecent(path)
  markSaved()
  toast('Saved')
}

export type ExportFormat = 'png' | 'jpeg' | 'webp'

export async function renderExport(format: ExportFormat, quality: number, scale = 1, matte = '#ffffff'): Promise<Blob> {
  const d = S().doc!
  const flat = flattenToCanvas(d)
  const w = Math.max(1, Math.round(d.width * scale)), h = Math.max(1, Math.round(d.height * scale))
  const c = makeCanvas(w, h)
  const g = ctx2d(c)
  if (format === 'jpeg') {
    g.fillStyle = matte
    g.fillRect(0, 0, w, h)
  }
  g.imageSmoothingQuality = 'high'
  g.drawImage(flat, 0, 0, w, h)
  return canvasToBlob(c, `image/${format}`, format === 'png' ? undefined : quality)
}

export async function exportImage(format: ExportFormat, quality: number, scale = 1) {
  const s = S()
  if (!s.doc) return false
  const blob = await renderExport(format, quality, scale)
  const ext = format === 'jpeg' ? 'jpg' : format
  const label = format === 'jpeg' ? 'JPEG' : format.toUpperCase()
  const r = await saveAs(`${stripExt(s.docName)}.${ext}`, [{ name: label, extensions: format === 'jpeg' ? ['jpg', 'jpeg'] : [ext] }], new Uint8Array(await blob.arrayBuffer()))
  if (r) toast(`Exported ${baseName(r)}`)
  return !!r
}

export function newFromLayerImage(c: HTMLCanvasElement) {
  return rasterLayer('Layer', { id: uid('bmp'), canvas: c })
}
