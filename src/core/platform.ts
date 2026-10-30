/** Thin layer over Electron IPC with browser fallbacks, so the same code runs on the web. */

export interface OpenedFile {
  name: string
  path: string | null
  data: Uint8Array
}

export interface FileFilter {
  name: string
  extensions: string[]
}

interface Bridge {
  openFile(filters: FileFilter[]): Promise<OpenedFile | null>
  readFile(path: string): Promise<OpenedFile | null>
  saveFile(opts: { defaultPath: string; filters: FileFilter[]; data: Uint8Array }): Promise<string | null>
  writeFile(path: string, data: Uint8Array): Promise<boolean>
  onOpenPath(cb: (path: string) => void): void
  initialFile(): Promise<string | null>
  setDirty(dirty: boolean): void
  setTitle(title: string): void
  showInFolder(path: string): void
  openExternal(url: string): void
  pathForFile(file: File): string | null
  version: string
}

declare global {
  interface Window {
    sfa?: Bridge
  }
}

export const bridge = typeof window !== 'undefined' ? window.sfa : undefined
export const isDesktop = !!bridge

export const IMAGE_FILTERS: FileFilter[] = [
  { name: 'Images & projects', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'psd', 'sfas'] },
  { name: 'SFA Studio project', extensions: ['sfas'] },
  { name: 'Photoshop document', extensions: ['psd'] },
]

export async function pickFile(filters = IMAGE_FILTERS): Promise<OpenedFile | null> {
  if (bridge) return bridge.openFile(filters)
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = filters.flatMap(f => f.extensions.map(e => `.${e}`)).join(',')
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return resolve(null)
      resolve({ name: f.name, path: null, data: new Uint8Array(await f.arrayBuffer()) })
    }
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

/** Save with a dialog. Returns the chosen path (desktop) or the file name (web), or null if cancelled. */
export async function saveAs(name: string, filters: FileFilter[], data: Uint8Array): Promise<string | null> {
  if (bridge) return bridge.saveFile({ defaultPath: name, filters, data })
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: name,
        types: filters.map(f => ({ description: f.name, accept: { 'application/octet-stream': f.extensions.map(e => `.${e}`) } })),
      })
      const ws = await handle.createWritable()
      await ws.write(data as BlobPart)
      await ws.close()
      return handle.name
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null
    }
  }
  const url = URL.createObjectURL(new Blob([data as BlobPart]))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return name
}

export async function writeTo(path: string, data: Uint8Array) {
  return bridge ? bridge.writeFile(path, data) : false
}

export function baseName(p: string) {
  return p.split(/[\\/]/).pop() ?? p
}

export function stripExt(n: string) {
  return n.replace(/\.[^.]+$/, '')
}

const RECENT_KEY = 'sfa.studio.recent'
export function recentFiles(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}
export function pushRecent(path: string) {
  try {
    const list = [path, ...recentFiles().filter(p => p !== path)].slice(0, 8)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch { /* ignore */ }
}
export function dropRecent(path: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentFiles().filter(p => p !== path)))
  } catch { /* ignore */ }
}
