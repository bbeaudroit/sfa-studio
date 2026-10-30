// SFA Studio — Electron main process.
const { app, BrowserWindow, dialog, ipcMain, shell, session, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const fss = require('node:fs')

const DEV_URL = process.env.VITE_DEV_SERVER_URL
const OPENABLE = /\.(png|jpe?g|webp|gif|bmp|avif|psd|sfas)$/i

let win = null
let dirty = false
let pendingFile = fileFromArgv(process.argv)

function fileFromArgv(argv) {
  const f = argv.slice(1).find(a => OPENABLE.test(a) && fss.existsSync(a))
  return f ? path.resolve(f) : null
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const f = fileFromArgv(argv)
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
      if (f) win.webContents.send('open-path', f)
    }
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 620,
    show: false,
    backgroundColor: '#070708',
    title: 'SFA Studio',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#070708', symbolColor: '#b9b9c0', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      additionalArguments: [`--sfa-version=${app.getVersion()}`],
    },
  })

  win.once('ready-to-show', () => {
    win.maximize()
    win.show()
  })

  if (DEV_URL) win.loadURL(DEV_URL)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  // Keep the app inside the app; links go to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (DEV_URL && url.startsWith(DEV_URL)) return
    e.preventDefault()
  })

  if (DEV_URL || process.env.SFA_DEVTOOLS) {
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
    })
  }

  win.on('close', e => {
    if (!dirty) return
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Discard changes', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'SFA Studio',
      message: 'Close without saving?',
      detail: 'Your unsaved changes will be lost.',
    })
    if (choice === 1) e.preventDefault()
  })
  win.on('closed', () => { win = null })
}

async function readOpened(p) {
  try {
    const data = await fs.readFile(p)
    return { name: path.basename(p), path: p, data: new Uint8Array(data) }
  } catch {
    return null
  }
}

ipcMain.handle('open-file', async (_e, filters) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters })
  if (r.canceled || !r.filePaths[0]) return null
  return readOpened(r.filePaths[0])
})

ipcMain.handle('read-file', (_e, p) => (typeof p === 'string' && OPENABLE.test(p) ? readOpened(p) : null))

ipcMain.handle('save-file', async (_e, { defaultPath, filters, data }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath, filters })
  if (r.canceled || !r.filePath) return null
  await fs.writeFile(r.filePath, Buffer.from(data))
  return r.filePath
})

ipcMain.handle('write-file', async (_e, p, data) => {
  // Only overwrite files the app works with.
  if (typeof p !== 'string' || !OPENABLE.test(p)) return false
  try {
    await fs.writeFile(p, Buffer.from(data))
    return true
  } catch {
    return false
  }
})

ipcMain.handle('initial-file', () => {
  const f = pendingFile
  pendingFile = null
  return f
})

ipcMain.on('set-dirty', (_e, v) => { dirty = !!v })
ipcMain.on('set-title', (_e, t) => { if (win && typeof t === 'string') win.setTitle(t) })
ipcMain.on('show-in-folder', (_e, p) => { if (typeof p === 'string') shell.showItemInFolder(p) })
ipcMain.on('open-external', (_e, url) => { if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url) })

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  const allowed = new Set(['local-fonts', 'clipboard-read', 'clipboard-sanitized-write'])
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)))
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => allowed.has(perm))
  createWindow()
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
