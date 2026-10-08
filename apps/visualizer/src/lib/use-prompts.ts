import { useEffect, useRef, useState } from 'react'
import { fetchPrompts, type PromptsResponse } from './api'
import { renderMarkdown } from './markdown'
import type { Phase } from './types'

export type TPromptPanel = Readonly<{
  id: string
  title: string
  text: string
  html: string
  lines: number
}>

export type TPrompts = Readonly<{
  state: 'idle' | 'loading' | 'ready' | 'error'
  panels: readonly TPromptPanel[]
}>

const panelsFor = (response: PromptsResponse): readonly TPromptPanel[] =>
  (
    [
      ['system', 'system prompt', response.system],
      ['user', 'user prompt', response.user],
    ] as const
  )
    .filter(([, , text]) => text !== null && text !== undefined)
    .map(([id, title, text]) => ({
      id,
      title,
      text: text as string,
      html: renderMarkdown(text as string),
      lines: (text as string).split('\n').length,
    }))

/**
 * The exact prompts sent to this phase's agent, fetched once per (run, agent).
 *
 * The cache is module-level and deliberately outlives the component: the trace
 * view unmounts this panel whenever the reader closes a phase, and prompts for
 * a finished run cannot change. Keyed on run and agent rather than phase, for
 * the same reason.
 */
const CACHE = new Map<string, PromptsResponse>()

export const usePrompts = (phase: Phase, workspace?: string): TPrompts => {
  const key =
    phase.kind === 'agent' && phase.owner
      ? `${workspace ?? ''}:${phase.run_id}:${phase.owner}`
      : undefined

  const [prompts, setPrompts] = useState<TPrompts>({ state: 'idle', panels: [] })
  const lastKey = useRef<string | undefined>(undefined)

  useEffect(() => {
    /*
     * The trace view replaces the phase object on every poll tick, so this
     * guards on the (run, agent) key rather than the object: without it, the
     * panels would refetch and snap shut twice a second.
     */
    if (key === lastKey.current) return undefined
    lastKey.current = key

    if (key === undefined || !phase.owner) {
      setPrompts({ state: 'idle', panels: [] })
      return undefined
    }

    const cached = CACHE.get(key)
    if (cached !== undefined) {
      setPrompts({ state: 'ready', panels: panelsFor(cached) })
      return undefined
    }

    let live = true
    setPrompts({ state: 'loading', panels: [] })
    void (async () => {
      try {
        const result = await fetchPrompts(
          phase.run_id,
          phase.owner ?? '',
          workspace,
        )
        CACHE.set(key, result)
        if (live) setPrompts({ state: 'ready', panels: panelsFor(result) })
      } catch {
        if (live) setPrompts({ state: 'error', panels: [] })
      }
    })()

    return () => {
      live = false
    }
  }, [key, phase.run_id, phase.owner, workspace])

  return prompts
}
