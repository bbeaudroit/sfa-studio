// Renders app icons and installer graphics from the SFA mark.
// Run: npm run icons   (uses Electron's Chromium for crisp SVG + Geist text)
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const root = path.join(__dirname, '..')
const out = path.join(root, 'build')
const fontUrl = 'file:///' + path.join(root, 'node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2').replace(/\\/g, '/')

const MARK = (sq, dia) => `<g fill="${sq}"><rect x="3" y="3" width="11.5" height="11.5" rx="2.75"/><rect x="17.5" y="3" width="11.5" height="11.5" rx="2.75"/><rect x="3" y="17.5" width="11.5" height="11.5" rx="2.75"/></g><rect x="18.25" y="18.25" width="10.5" height="10.5" rx="2" transform="rotate(45 23.5 23.5)" fill="${dia}"/>`
const APP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0a0a0a"/><g transform="translate(4 4) scale(.75)">${MARK('#fafafa', '#C6FF3D')}</g></svg>`
const DOC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M7 1.5h12.5L27 9v19a2.5 2.5 0 0 1-2.5 2.5h-17A2.5 2.5 0 0 1 5 28V4a2.5 2.5 0 0 1 2-2.5z" fill="#0a0a0a" stroke="#C6FF3D" stroke-width="1.2"/><path d="M19.5 1.5V9H27" fill="none" stroke="#C6FF3D" stroke-width="1.2"/><g transform="translate(9 12) scale(.45)">${MARK('#fafafa', '#C6FF3D')}</g></svg>`

function renderer() {
  // Runs inside the page.
  return `
  const img = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/svg+xml;base64,' + btoa(src) })
  window.png = async (svg, size) => {
    const c = document.createElement('canvas'); c.width = c.height = size
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'
    g.drawImage(await img(svg), 0, 0, size, size)
    return c.toDataURL('image/png')
  }
  window.art = async (kind, markSvg) => {
    await document.fonts.load('600 20px Geist'); await document.fonts.load('400 12px Geist')
    const mark = await img(markSvg)
    const c = document.createElement('canvas'); const g = c.getContext('2d')
    if (kind === 'sidebar' || kind === 'unsidebar') {
      c.width = 164; c.height = 314
      g.fillStyle = '#0b0b0c'; g.fillRect(0, 0, 164, 314)
      const glow = g.createRadialGradient(150, 300, 0, 150, 300, 200)
      glow.addColorStop(0, 'rgba(198,255,61,.22)'); glow.addColorStop(1, 'rgba(198,255,61,0)')
      g.fillStyle = glow; g.fillRect(0, 0, 164, 314)
      g.globalAlpha = .07; g.drawImage(mark, 40, 150, 210, 210); g.globalAlpha = 1
      g.drawImage(mark, 22, 26, 34, 34)
      g.fillStyle = '#fafafa'; g.font = '600 19px Geist'; g.fillText('SFA Studio', 22, 92)
      g.fillStyle = '#8a8a93'; g.font = '400 11.5px Geist'
      g.fillText(kind === 'sidebar' ? 'Photo editor' : 'Uninstall', 22, 111)
      g.fillStyle = '#C6FF3D'; g.fillRect(22, 124, 18, 2)
      g.fillStyle = '#55555d'; g.font = '400 10px Geist'; g.fillText('Free · open source', 22, 296)
    } else {
      c.width = 150; c.height = 57
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 150, 57)
      g.drawImage(mark, 112, 14, 28, 28)
    }
    return c.toDataURL('image/png')
  }`
}

function bmp24(rgba, w, h) {
  const row = Math.ceil((w * 3) / 4) * 4
  const size = 54 + row * h
  const b = Buffer.alloc(size)
  b.write('BM', 0)
  b.writeUInt32LE(size, 2)
  b.writeUInt32LE(54, 10)
  b.writeUInt32LE(40, 14)
  b.writeInt32LE(w, 18)
  b.writeInt32LE(h, 22)
  b.writeUInt16LE(1, 26)
  b.writeUInt16LE(24, 28)
  b.writeUInt32LE(row * h, 34)
  b.writeInt32LE(2835, 38)
  b.writeInt32LE(2835, 42)
  for (let y = 0; y < h; y++) {
    const dst = 54 + (h - 1 - y) * row
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4
      b[dst + x * 3] = rgba[s + 2]
      b[dst + x * 3 + 1] = rgba[s + 1]
      b[dst + x * 3 + 2] = rgba[s]
    }
  }
  return b
}

app.whenReady().then(async () => {
  const { default: pngToIco } = await import('png-to-ico')
  const win = new BrowserWindow({ show: false })
  setTimeout(() => { console.error('timed out'); app.exit(1) }, 60000)
  const tmp = path.join(out, '.art.html')
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(tmp, `<style>@font-face{font-family:Geist;src:url(${fontUrl})}</style><body>`)
  await win.loadFile(tmp)
  fs.unlinkSync(tmp)
  console.log('page loaded')
  await win.webContents.executeJavaScript(renderer() + ';0')
  const dataUrlToBuf = d => Buffer.from(d.split(',')[1], 'base64')
  fs.mkdirSync(out, { recursive: true })

  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
  console.log('rendering icons')
  for (const [svg, name] of [[APP_SVG, 'icon'], [DOC_SVG, 'project']]) {
    const pngs = []
    for (const s of sizes) pngs.push(dataUrlToBuf(await win.webContents.executeJavaScript(`png(${JSON.stringify(svg)}, ${s})`)))
    fs.writeFileSync(path.join(out, `${name}.ico`), await pngToIco(pngs))
  }
  fs.writeFileSync(path.join(out, 'icon.png'), dataUrlToBuf(await win.webContents.executeJavaScript(`png(${JSON.stringify(APP_SVG)}, 512)`)))
  fs.copyFileSync(path.join(out, 'icon.png'), path.join(root, 'public', 'icon-512.png'))

  const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${MARK('#fafafa', '#C6FF3D')}</svg>`
  const MARK_DARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${MARK('#0a0a0a', '#9bd11a')}</svg>`
  for (const [kind, file, svg] of [['sidebar', 'installerSidebar', MARK_SVG], ['unsidebar', 'uninstallerSidebar', MARK_SVG], ['header', 'installerHeader', MARK_DARK]]) {
    const png = dataUrlToBuf(await win.webContents.executeJavaScript(`art(${JSON.stringify(kind)}, ${JSON.stringify(svg)})`))
    const { nativeImage } = require('electron')
    const im = nativeImage.createFromBuffer(png)
    const { width, height } = im.getSize()
    // nativeImage bitmaps are BGRA
    const bgra = im.toBitmap()
    const rgba = Buffer.alloc(bgra.length)
    for (let i = 0; i < bgra.length; i += 4) { rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = 255 }
    fs.writeFileSync(path.join(out, `${file}.bmp`), bmp24(rgba, width, height))
    fs.writeFileSync(path.join(out, `${file}.preview.png`), png)
  }
  console.log('art written to', out)
  app.quit()
})
