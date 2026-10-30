import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { invalidateFonts } from './core/render'
import { bump } from './core/store'
import { loadDemo } from './demo'

// Canvas text needs the web fonts decoded before first use.
Promise.all([
  document.fonts.load('600 32px "Geist Variable"'),
  document.fonts.load('400 32px "Geist Mono Variable"'),
]).then(() => { invalidateFonts(); bump() }).catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (location.hash.startsWith('#demo')) setTimeout(() => loadDemo(location.hash.slice(6)), 300)

if (import.meta.env.DEV) {
  import('./core/store').then(m => ((window as unknown as { __studio: unknown }).__studio = m))
}
