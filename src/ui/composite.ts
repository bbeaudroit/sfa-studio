import { compositeDoc } from '../core/render'
import { S } from '../core/store'
import type { Doc } from '../core/types'
import type { Preview } from '../core/render'

let key: { doc: Doc | null; ver: number; preview: Preview | null } = { doc: null, ver: -1, preview: null }
let canvas: HTMLCanvasElement | null = null
let previewTick = 0
let lastPreviewTick = -1

/** Call when a preview canvas was redrawn in place (same object, new pixels). */
export function touchPreview() {
  previewTick++
}

/** The current flattened document, recomputed only when something changed. */
export function getComposite(): HTMLCanvasElement | null {
  const { doc, ver, preview } = S()
  if (!doc) return null
  if (canvas && key.doc === doc && key.ver === ver && key.preview === preview && lastPreviewTick === previewTick) return canvas
  canvas = compositeDoc(doc, ver, preview)
  key = { doc, ver, preview }
  lastPreviewTick = previewTick
  return canvas
}
