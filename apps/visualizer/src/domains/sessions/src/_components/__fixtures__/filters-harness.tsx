/**
 * Mounts a real `SessionsList` so `FilterDropdown.behavior.test.ts` can drive
 * actual clicks, actual event listeners, and a real `sessionStorage` in a
 * real browser. Not shipped; loaded only by that test's in-memory Vite
 * server.
 */
import { createRoot } from 'react-dom/client'
import '@/style.css'
import { SessionsList } from '../../../index'

const el = document.getElementById('app')
if (el) createRoot(el).render(<SessionsList />)
