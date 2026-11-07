import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/play/400.css'
import '@fontsource/play/700.css'
import { applyTheme, storedTheme } from '@/domains/themes'
import { App } from './App'
import './style.css'

/**
 * The theme goes on before React does.
 *
 * Mounting first would paint one frame in the wrong palette — the flash this
 * design exists to avoid — and the theme layer deliberately has no React in
 * it so it can run here.
 */
applyTheme(
  document.documentElement,
  storedTheme(window.localStorage),
  window.matchMedia,
)

const container = document.getElementById('app')
if (container === null) {
  throw new Error('index.html is missing #app; nothing can be mounted')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
