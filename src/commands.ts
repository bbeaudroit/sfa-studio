import { ADJUSTMENTS } from './core/adjustments'
import { confirmDiscard, openDialog, paste, placeDialog, savePsd, saveProject } from './core/files'
import {
  autoAdjust, addAdjustment, addLayer, addMask, applyMask, deleteMask, toggleClip, toggleMask, clearSelected, copy, cropToSelection, deleteLayer, deselect, duplicateLayer,
  fillSelection, flatten, flipCanvas, flipLayer, invertSelection, mergeDown, mergeVisible, rasterize,
  rotateCanvas, selectAll, stepLayer, trimTransparent,
} from './core/ops'
import { S, activeLayer, closeDoc, redo, set, setOpt, undo, updateDoc, type ToolId } from './core/store'
import { actualPixels, fillView, fitView, zoomStep } from './core/view'
import { bridge } from './core/platform'
import { beginTransform } from './tools/tools'
import type { AdjustmentType } from './core/types'

export interface Command {
  id: string
  label: string
  keys?: string
  run: () => void
  enabled?: () => boolean
  checked?: () => boolean
}

const hasDoc = () => !!S().doc
const hasSel = () => !!S().doc?.selection
const canUndo = () => !!S().doc && (S().hIndex > 0 || S().doc !== S().history[S().hIndex]?.doc)
const canRedo = () => !!S().doc && S().hIndex < S().history.length - 1
const isKind = (...k: string[]) => () => !!activeLayer() && k.includes(activeLayer()!.kind)

const adjKeys: Partial<Record<AdjustmentType, string>> = { levels: 'Ctrl+L', curves: 'Ctrl+M', hue: 'Ctrl+U', invert: 'Ctrl+I', bw: 'Ctrl+Alt+Shift+B' }

const list: Command[] = [
  // File
  { id: 'new', label: 'New canvas…', keys: 'Ctrl+N', run: () => set({ dialog: 'new' }) },
  { id: 'open', label: 'Open…', keys: 'Ctrl+O', run: openDialog },
  { id: 'place', label: 'Place image as layer…', keys: 'Ctrl+Shift+P', run: placeDialog, enabled: hasDoc },
  { id: 'save', label: 'Save project', keys: 'Ctrl+S', run: () => saveProject(), enabled: hasDoc },
  { id: 'saveAs', label: 'Save project as…', keys: 'Ctrl+Shift+S', run: () => saveProject(true), enabled: hasDoc },
  { id: 'savePsd', label: 'Save as PSD…', run: savePsd, enabled: hasDoc },
  { id: 'export', label: 'Export image…', keys: 'Ctrl+Shift+E', run: () => set({ dialog: 'export' }), enabled: hasDoc },
  { id: 'close', label: 'Close', keys: 'Ctrl+W', run: async () => { if (await confirmDiscard()) closeDoc() }, enabled: hasDoc },
  // Edit
  { id: 'undo', label: 'Undo', keys: 'Ctrl+Z', run: undo, enabled: canUndo },
  { id: 'redo', label: 'Redo', keys: 'Ctrl+Shift+Z', run: redo, enabled: canRedo },
  { id: 'redoAlt', label: 'Redo', keys: 'Ctrl+Y', run: redo, enabled: canRedo },
  { id: 'cut', label: 'Cut', keys: 'Ctrl+X', run: () => copy(true), enabled: hasDoc },
  { id: 'copy', label: 'Copy', keys: 'Ctrl+C', run: () => copy(), enabled: hasDoc },
  { id: 'copyMerged', label: 'Copy merged', keys: 'Ctrl+Shift+C', run: () => copy(false, true), enabled: hasDoc },
  { id: 'paste', label: 'Paste', keys: 'Ctrl+V', run: () => paste() },
  { id: 'clear', label: 'Delete', keys: 'Delete', run: clearSelected, enabled: hasDoc },
  { id: 'fillFg', label: 'Fill with foreground', keys: 'Alt+Backspace', run: () => fillSelection(S().fg), enabled: hasDoc },
  { id: 'fillBg', label: 'Fill with background', keys: 'Ctrl+Backspace', run: () => fillSelection(S().bg), enabled: hasDoc },
  { id: 'transform', label: 'Free transform', keys: 'Ctrl+T', run: beginTransform, enabled: isKind('raster', 'text', 'shape') },
  // Image
  { id: 'imageSize', label: 'Image size…', keys: 'Ctrl+Alt+I', run: () => set({ dialog: 'imageSize' }), enabled: hasDoc },
  { id: 'canvasSize', label: 'Canvas size…', keys: 'Ctrl+Alt+C', run: () => set({ dialog: 'canvasSize' }), enabled: hasDoc },
  { id: 'rotCW', label: 'Rotate 90° clockwise', run: () => rotateCanvas(90), enabled: hasDoc },
  { id: 'rotCCW', label: 'Rotate 90° counter-clockwise', run: () => rotateCanvas(-90), enabled: hasDoc },
  { id: 'rot180', label: 'Rotate 180°', run: () => rotateCanvas(180), enabled: hasDoc },
  { id: 'flipH', label: 'Flip canvas horizontal', run: () => flipCanvas('h'), enabled: hasDoc },
  { id: 'flipV', label: 'Flip canvas vertical', run: () => flipCanvas('v'), enabled: hasDoc },
  { id: 'cropSel', label: 'Crop to selection', run: cropToSelection, enabled: hasSel },
  { id: 'trim', label: 'Trim transparent pixels', run: trimTransparent, enabled: hasDoc },
  // Layer
  { id: 'newLayer', label: 'New layer', keys: 'Ctrl+Shift+N', run: addLayer, enabled: hasDoc },
  { id: 'dupLayer', label: 'Duplicate layer', keys: 'Ctrl+J', run: duplicateLayer, enabled: hasDoc },
  { id: 'delLayer', label: 'Delete layer', run: () => deleteLayer(), enabled: hasDoc },
  { id: 'mergeDown', label: 'Merge down', keys: 'Ctrl+E', run: mergeDown, enabled: hasDoc },
  { id: 'mergeVisible', label: 'Merge visible', keys: 'Ctrl+Shift+Alt+E', run: mergeVisible, enabled: hasDoc },
  { id: 'flatten', label: 'Flatten image', run: flatten, enabled: hasDoc },
  { id: 'addMask', label: 'Add mask', run: () => addMask(), enabled: () => !!activeLayer() && !activeLayer()!.mask },
  { id: 'addMaskHide', label: 'Add mask (hide all)', run: () => addMask('hide'), enabled: () => !!activeLayer() && !activeLayer()!.mask },
  { id: 'toggleMask', label: 'Disable mask', run: () => toggleMask(), enabled: () => !!activeLayer()?.mask, checked: () => activeLayer()?.mask?.enabled === false },
  { id: 'applyMask', label: 'Apply mask', run: applyMask, enabled: () => !!activeLayer()?.mask && activeLayer()!.kind !== 'adjust' },
  { id: 'deleteMask', label: 'Delete mask', run: () => deleteMask(), enabled: () => !!activeLayer()?.mask },
  { id: 'clip', label: 'Clipping mask', keys: 'Ctrl+Alt+G', run: () => toggleClip(), enabled: hasDoc, checked: () => !!activeLayer()?.clip },
  { id: 'rasterize', label: 'Rasterize layer', run: () => rasterize(), enabled: isKind('text', 'shape') },
  { id: 'layerUp', label: 'Bring forward', keys: 'Ctrl+]', run: () => stepLayer(1), enabled: hasDoc },
  { id: 'layerDown', label: 'Send backward', keys: 'Ctrl+[', run: () => stepLayer(-1), enabled: hasDoc },
  { id: 'flipLayerH', label: 'Flip layer horizontal', run: () => flipLayer('h'), enabled: isKind('raster', 'shape', 'text') },
  { id: 'flipLayerV', label: 'Flip layer vertical', run: () => flipLayer('v'), enabled: isKind('raster', 'shape', 'text') },
  { id: 'toggleLock', label: 'Lock layer', keys: 'Ctrl+/', run: () => { const l = activeLayer(); if (l) updateDoc(d => ({ ...d, layers: d.layers.map(x => x.id === l.id ? { ...x, locked: !x.locked } : x) }), l.locked ? 'Unlock layer' : 'Lock layer') }, enabled: hasDoc, checked: () => !!activeLayer()?.locked },
  // Adjustments
  ...ADJUSTMENTS.map(a => ({ id: `adj:${a.type}`, label: a.label, keys: adjKeys[a.type], run: () => addAdjustment(a.type), enabled: hasDoc })),
  { id: 'autoTone', label: 'Auto tone', keys: 'Ctrl+Shift+L', run: () => autoAdjust('tone'), enabled: hasDoc },
  { id: 'autoContrast', label: 'Auto contrast', keys: 'Ctrl+Alt+Shift+L', run: () => autoAdjust('contrast'), enabled: hasDoc },
  // Select
  { id: 'selectAll', label: 'All', keys: 'Ctrl+A', run: selectAll, enabled: hasDoc },
  { id: 'deselect', label: 'Deselect', keys: 'Ctrl+D', run: deselect, enabled: hasSel },
  { id: 'invertSel', label: 'Inverse', keys: 'Ctrl+Shift+I', run: invertSelection, enabled: hasSel },
  // Filter
  { id: 'blur', label: 'Gaussian blur…', run: () => set({ dialog: { filter: 'blur' } }), enabled: isKind('raster') },
  { id: 'sharpen', label: 'Sharpen…', run: () => set({ dialog: { filter: 'sharpen' } }), enabled: isKind('raster') },
  { id: 'noise', label: 'Add noise…', run: () => set({ dialog: { filter: 'noise' } }), enabled: isKind('raster') },
  // View
  { id: 'zoomIn', label: 'Zoom in', keys: 'Ctrl+=', run: () => zoomStep(1), enabled: hasDoc },
  { id: 'zoomOut', label: 'Zoom out', keys: 'Ctrl+-', run: () => zoomStep(-1), enabled: hasDoc },
  { id: 'fit', label: 'Fit on screen', keys: 'Ctrl+0', run: () => fitView(), enabled: hasDoc },
  { id: 'fill', label: 'Fill screen', run: fillView, enabled: hasDoc },
  { id: 'actual', label: 'Actual pixels', keys: 'Ctrl+1', run: actualPixels, enabled: hasDoc },
  { id: 'rulers', label: 'Rulers', keys: 'Ctrl+R', run: () => set(s => ({ rulers: !s.rulers })), checked: () => S().rulers },
  { id: 'guides', label: 'Guides', keys: 'Ctrl+;', run: () => set(s => ({ showGuides: !s.showGuides })), checked: () => S().showGuides },
  { id: 'snap', label: 'Snap', keys: 'Ctrl+Shift+;', run: () => setOpt('move', { snap: !S().opts.move.snap }), checked: () => S().opts.move.snap },
  { id: 'palette', label: 'Search commands', keys: 'Ctrl+F', run: () => set(s => ({ palette: !s.palette })) },
  { id: 'clearGuides', label: 'Clear guides', run: () => updateDoc(d => ({ ...d, guides: { h: [], v: [] } }), 'Clear guides'), enabled: () => !!S().doc && (S().doc!.guides.h.length + S().doc!.guides.v.length > 0) },
  // Help
  { id: 'shortcuts', label: 'Keyboard shortcuts', keys: 'Ctrl+/', run: () => set({ dialog: 'shortcuts' }) },
  { id: 'about', label: 'About SFA Studio', run: () => set({ dialog: 'about' }) },
  { id: 'github', label: 'Source code on GitHub', run: () => openUrl('https://github.com/bbeaudroit/sfa-studio') },
  { id: 'issue', label: 'Report a problem', run: () => openUrl('https://github.com/bbeaudroit/sfa-studio/issues/new') },
]

// Ctrl+/ belongs to the shortcuts sheet; lock uses the menu/button.
list.find(c => c.id === 'toggleLock')!.keys = undefined

export function openUrl(url: string) {
  if (bridge) bridge.openExternal(url)
  else window.open(url, '_blank', 'noopener')
}

export const COMMANDS: Record<string, Command> = Object.fromEntries(list.map(c => [c.id, c]))

export function run(id: string) {
  const c = COMMANDS[id]
  if (c && (!c.enabled || c.enabled())) c.run()
}

// --- Tools -------------------------------------------------------------------

export interface ToolDef {
  id: ToolId
  label: string
  key: string
}

export const TOOL_DEFS: ToolDef[] = [
  { id: 'move', label: 'Move', key: 'V' },
  { id: 'marquee', label: 'Marquee', key: 'M' },
  { id: 'lasso', label: 'Lasso', key: 'L' },
  { id: 'wand', label: 'Magic wand', key: 'W' },
  { id: 'crop', label: 'Crop', key: 'C' },
  { id: 'eyedropper', label: 'Eyedropper', key: 'I' },
  { id: 'brush', label: 'Brush', key: 'B' },
  { id: 'eraser', label: 'Eraser', key: 'E' },
  { id: 'clone', label: 'Clone stamp', key: 'S' },
  { id: 'dodge', label: 'Dodge / burn / sponge', key: 'O' },
  { id: 'focus', label: 'Blur / sharpen', key: 'R' },
  { id: 'bucket', label: 'Fill', key: 'G' },
  { id: 'gradient', label: 'Gradient', key: 'G' },
  { id: 'text', label: 'Text', key: 'T' },
  { id: 'shape', label: 'Shape', key: 'U' },
  { id: 'hand', label: 'Hand', key: 'H' },
  { id: 'zoom', label: 'Zoom', key: 'Z' },
  { id: 'transform', label: 'Free transform', key: 'Ctrl+T' },
]

export function keyString(e: KeyboardEvent) {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  let k = e.key
  if (k === '+') k = '='
  if (k === ' ') k = 'Space'
  if (k.length === 1) k = k.toUpperCase()
  // Shift changes the key glyph on some layouts; fall back to the physical key.
  if (e.shiftKey && /^Digit|^Key/.test(e.code)) k = e.code.replace(/^Digit|^Key/, '')
  if (e.code === 'BracketLeft') k = '['
  if (e.code === 'BracketRight') k = ']'
  if (e.code === 'Semicolon') k = ';'
  if (e.code === 'Slash') k = '/'
  if (e.code === 'Equal') k = '='
  if (e.code === 'Minus') k = '-'
  parts.push(k)
  return parts.join('+')
}

const canonical = (k: string) => {
  const parts = k.split('+')
  const key = parts.pop()!
  const mods = ['Ctrl', 'Alt', 'Shift'].filter(m => parts.includes(m))
  return [...mods, key.length === 1 ? key.toUpperCase() : key].join('+')
}

const byKey = new Map(list.filter(c => c.keys).map(c => [canonical(c.keys!), c.id]))
byKey.set('Ctrl+Shift+=', 'zoomIn')
byKey.set('Backspace', 'clear')

export function commandForKey(e: KeyboardEvent): string | undefined {
  return byKey.get(keyString(e))
}
