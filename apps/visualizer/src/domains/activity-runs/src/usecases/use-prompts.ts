import { settleAsync } from '@typedefs/settlement'
import { useEffect, useRef, useState } from 'react'
import { renderMarkdown } from '@/lib/markdown'
import { fetchPrompts, type PromptsResponse } from '../io/fetch-prompts'
import type { ActivityRun } from '../typedefs/activity-run'

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
 * The exact prompts sent to this activity-run's agent, fetched once per (run, agent).
 *
 * The cache is module-level and deliberately outlives the component: the trace
 * view unmounts this panel whenever the reader closes a activityRun, and prompts for
 * a finished run cannot change. Keyed on run and agent rather than activityRun, for
 * the same reason.
 */
const CACHE = new Map<string, PromptsResponse>()

export const usePrompts = (
  activityRun: ActivityRun,
  workspace?: string,
): TPrompts => {
  const key =
    activityRun.kind === 'agent' && activityRun.owner
      ? `${workspace ?? ''}:${activityRun.run_id}:${activityRun.owner}`
      : undefined

  const [prompts, setPrompts] = useState<TPrompts>({
    state: 'idle',
    panels: [],
  })
  const lastKey = useRef<string | undefined>(undefined)

  useEffect(() => {
    /*
     * The trace view replaces the activityRun object on every poll tick, so this
     * guards on the (run, agent) key rather than the object: without it, the
     * panels would refetch and snap shut twice a second.
     */
    if (key === lastKey.current) return undefined
    lastKey.current = key

    if (key === undefined || !activityRun.owner) {
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
      const settled = await settleAsync(() =>
        fetchPrompts(activityRun.run_id, activityRun.owner ?? '', workspace),
      )
      if (settled.status === 'error') {
        // One panel that will not load, never a view that cannot render.
        if (live) setPrompts({ state: 'error', panels: [] })
        return
      }
      CACHE.set(key, settled.data)
      if (live) setPrompts({ state: 'ready', panels: panelsFor(settled.data) })
    })()

    return () => {
      live = false
    }
  }, [key, activityRun.run_id, activityRun.owner, workspace])

  return prompts
}
