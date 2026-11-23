import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TActivity,
  TActivityContext,
  TActivityRunHandle,
  TPiCrustConfig,
  TRun,
  TUnit,
} from '../../../../lib/contracts'
import { activityRunParams, crustConfigSchema } from '../../../../lib/contracts'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import { observedPayload, PATHS_TOUCHED, RUN_START } from '../../../policy'
import { createTracer } from '../../../trace'
import { createRun } from './create-run'

export const CONTEXT = {
  facts: [],
  decisions: [],
  assumptions: [],
  unresolved: [],
  risks: [],
  objective_met: { met: true, evidence: 'fixture' },
  regress_to: { activity: '', because: '' },
}

export const fixture = (
  tasks: unknown = {},
  resume: readonly string[] = [],
  activities: TPiCrustConfig['activities'] = [],
) => {
  const root = mkdtempSync(join(tmpdir(), 'crust-moments-'))
  const tracer = createTracer(
    join(root, 'trace.db'),
    join(root, 'events.jsonl'),
  )
  silenceTerminal()
  const run: TRun = {
    ...createRun({
      cfg: crustConfigSchema.parse({
        defaults: { data_dir: join(root, 'data') },
        tasks,
        activities,
      }),
      runId: 'moments1',
      tracer,
      engineer: 'tester',
      resume: new Set(resume),
    }),
    repoRoot: root,
    vcsRoot: root,
  }
  tracer.sessionStart(run.runId, 'tester', 'compose')
  tracer.event({
    run_id: run.runId,
    type: 'log',
    name: RUN_START,
    payload: { head: 'recorded-start', tree: {} },
  })
  return {
    run,
    [Symbol.dispose]: () => {
      restoreTerminal()
      tracer.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

export const context = (run: TRun): TActivityContext => ({
  run,
  prompt: '',
  previous: undefined,
  previousStep: undefined,
  upstream: [],
  cohort: [],
  baseline: '',
  outcomes: [],
  feedback: [],
})

export const observe = (
  run: TRun,
  instance: string,
  id: string,
  paths: readonly string[],
  agent = instance,
): void => {
  run.tracer.event({
    run_id: run.runId,
    activity_run_id: id,
    type: 'log',
    name: PATHS_TOUCHED,
    payload: observedPayload({
      activity: instance,
      activityRunId: id,
      agent,
      touched: paths,
      dirtyBefore: [],
      claimed: paths,
    }),
  })
}

export const writer = (
  instance: string,
  body: (
    ctx: TActivityContext,
    handle: TActivityRunHandle,
  ) => void | Promise<void> = () => undefined,
  options: Readonly<{
    name?: string
    attempts?: number
    paths?: readonly string[]
  }> = {},
): TActivity => ({
  name: options.name ?? instance,
  instance,
  params: activityRunParams({
    name: instance,
    owner: options.name ?? instance,
    kind: 'agent',
    description: 'Write a fixture change for task verification.',
  }),
  requires: [],
  gates: [],
  attempts: options.attempts ?? 4,
  commit: false,
  execute: async (ctx, handle) => {
    for (const path of options.paths ?? [])
      writeFileSync(join(ctx.run.repoRoot, path), 'change')
    if ((options.paths?.length ?? 0) > 0)
      observe(
        ctx.run,
        instance,
        handle.activityRun.activity_run_id,
        options.paths ?? [],
        options.name ?? instance,
      )
    await body(ctx, handle)
    return { previous: undefined, accepted: true }
  },
  replay: () => Promise.resolve({ previous: undefined, accepted: true }),
})

export const serial = (activities: readonly TActivity[]): readonly TUnit[] =>
  activities.map((activity) => ({
    stage: activity.instance,
    strategy: 'serial',
    activities: [activity],
    endsStage: true,
  }))
