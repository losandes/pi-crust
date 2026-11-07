/**
 * Mounts a single real `ThemePicker` into `#picker`, so
 * `ThemePicker.interaction.test.ts` can measure actual rendered geometry
 * and exercise real keyboard and pointer behaviour in a real browser. Not
 * shipped; loaded only by that test's in-memory Vite server.
 */
import { createRoot } from 'react-dom/client'
import '@/style.css'
import { ThemePicker } from '../ThemePicker'

const mount = (id: string) => {
  const el = document.getElementById(id)
  if (!el) return
  createRoot(el).render(<ThemePicker />)
}

mount('picker')
