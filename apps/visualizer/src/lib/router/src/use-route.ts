import { useSyncExternalStore } from 'react'
import { routeSnapshot, subscribeToRoute, type TRoute } from './router'

/** The current hash route, re-rendering the tree when it changes. */
export const useRoute = (): TRoute =>
  useSyncExternalStore(subscribeToRoute, routeSnapshot, routeSnapshot)
