// Captures README screenshots from the built app. Run: npm run build && npm run shots
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

app.commandLine.appendSwitch('force-device-scale-factor', '1')
const root = path.join(__dirname, '..')
const shots = [
  ['demo', 'studio-main.png'],
  ['demo-curves', 'studio-curves.png'],
  ['demo-sel', 'studio-selection.png'],
]

app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  setTimeout(() => app.exit(1), 90000)
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true })
  for (const [hash, file] of shots) {
    const win = new BrowserWindow({ width: 1440, height: 900, frame: false, show: true, backgroundColor: '#070708' })
    await win.loadFile(path.join(root, 'dist', 'index.html'), { hash })
    await new Promise(r => setTimeout(r, 2500))
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(root, 'docs', file), img.toPNG())
    console.log('wrote', file)
    win.destroy()
  }
  app.quit()
})
