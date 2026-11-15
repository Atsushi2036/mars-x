import './zod-config' // must stay the first import: schemas are built while later modules load
import { createRoot } from 'react-dom/client'
import './index.css'
import { applyTheme, useApp } from '@/store/app'
import App from './App'

// feature modules self-register their UI/scene slots (see src/ui/slots.tsx); register files must only register lazy components
import.meta.glob('./features/*/register.{ts,tsx}', { eager: true })

// No StrictMode on purpose: R3F + workers + GPU resources are created once per mount.
// @react-three/fiber 9.x still instantiates THREE.Clock, which three 0.187 flags as deprecated (harmless, upstream).
const warn = console.warn.bind(console)
console.warn = (...a: unknown[]) => {
  if (typeof a[0] === 'string' && a[0].includes('THREE.Clock')) return
  warn(...a)
}
applyTheme(useApp.getState().theme)
createRoot(document.getElementById('root')!).render(<App />)
