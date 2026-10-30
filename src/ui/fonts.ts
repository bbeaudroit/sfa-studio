import { useEffect, useState } from 'react'
import { bump } from '../core/store'
import { invalidateFonts } from '../core/render'

export const FONTS = [
  'Geist Variable', 'Geist Mono Variable', 'Arial', 'Helvetica', 'Segoe UI', 'Verdana', 'Tahoma', 'Trebuchet MS',
  'Georgia', 'Times New Roman', 'Garamond', 'Palatino Linotype', 'Courier New', 'Consolas', 'Impact', 'Comic Sans MS',
]

let cache: string[] | null = null
let loading: Promise<string[]> | null = null

async function loadSystemFonts(): Promise<string[]> {
  const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
  if (!q) return FONTS
  try {
    const fams = [...new Set((await q()).map(f => f.family))].sort((a, b) => a.localeCompare(b))
    return [...FONTS.slice(0, 2), ...fams.filter(f => !FONTS.slice(0, 2).includes(f))]
  } catch {
    return FONTS
  }
}

export function useFonts() {
  const [fonts, setFonts] = useState(cache ?? FONTS)
  useEffect(() => {
    if (cache) return
    loading ??= loadSystemFonts()
    loading.then(f => { cache = f; setFonts(f) })
  }, [])
  return fonts
}

// Re-render text once web fonts finish loading.
if (typeof document !== 'undefined') {
  document.fonts?.addEventListener('loadingdone', () => {
    invalidateFonts()
    bump()
  })
}
