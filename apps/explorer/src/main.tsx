import { createRoot } from 'react-dom/client'
import './index.css'
import { applyTheme, useApp } from '@/store/app'
import App from './App'

// No StrictMode on purpose: the terrain worker takes ownership (transfer) of the elevation buffer once.
// @react-three/fiber 9.x still instantiates THREE.Clock, which three 0.187 flags as deprecated (harmless, upstream).
const warn = console.warn.bind(console)
console.warn = (...a: unknown[]) => {
  if (typeof a[0] === 'string' && a[0].includes('THREE.Clock')) return
  warn(...a)
}
applyTheme(useApp.getState().theme)
createRoot(document.getElementById('root')!).render(<App />)
