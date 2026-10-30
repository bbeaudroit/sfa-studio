const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('sfa', {
  openFile: filters => ipcRenderer.invoke('open-file', filters),
  readFile: p => ipcRenderer.invoke('read-file', p),
  saveFile: opts => ipcRenderer.invoke('save-file', opts),
  writeFile: (p, data) => ipcRenderer.invoke('write-file', p, data),
  initialFile: () => ipcRenderer.invoke('initial-file'),
  onOpenPath: cb => ipcRenderer.on('open-path', (_e, p) => cb(p)),
  setDirty: v => ipcRenderer.send('set-dirty', v),
  setTitle: t => ipcRenderer.send('set-title', t),
  showInFolder: p => ipcRenderer.send('show-in-folder', p),
  openExternal: url => ipcRenderer.send('open-external', url),
  pathForFile: file => {
    try {
      return webUtils.getPathForFile(file) || null
    } catch {
      return null
    }
  },
  version: (process.argv.find(a => a.startsWith('--sfa-version=')) || '').split('=')[1] || '',
})
