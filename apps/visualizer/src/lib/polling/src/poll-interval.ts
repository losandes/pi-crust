import type { TSettlement } from '@typedefs'
import { createContext, useContext } from 'react'

export const DEFAULT_POLL_MS = 500

export const pollIntervalFrom = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_POLL_MS

export const pollIntervalOf = (
  health: TSettlement<Readonly<{ poll_ms?: unknown }>>,
): number =>
  health.status === 'ok'
    ? pollIntervalFrom(health.data.poll_ms)
    : DEFAULT_POLL_MS

export const PollIntervalContext = createContext(DEFAULT_POLL_MS)
export const usePollInterval = (): number => useContext(PollIntervalContext)
