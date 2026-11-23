import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TActivityContext, TRun } from '../../../../lib/contracts'
import {
  activityRunParams,
  buildOutputSchema,
  crustConfigSchema,
} from '../../../../lib/contracts'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import type { TTerminalActivity } from '../../../activities'
import { observedPayload, PATHS_TOUCHED } from '../../../policy'
import { createTracer } from '../../../trace'
import { createRun } from './create-run'
import { commitActivity } from './deliver'
import { runActivityRun } from './run-activity-run'

export const gitIn = (cwd: string, ...args: readonly string[]): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

export const terminalActivity = (
  deliver: TTerminalActivity['deliver'],
): TTerminalActivity => ({
  name: 'gh-pull-request',
  params: activityRunParams({
    name: 'gh-pull-request',
    kind: 'agent',
    owner: 'gh-pull-request',
    description: 'Deliver the accepted work',
  }),
  requires: [],
  requiresCommitting: true,
  deliver,
})

export const terminalContext = (run: TRun): TActivityContext => ({
  run,
  prompt: 'Implement issue #125',
  previous: undefined,
  previousStep: undefined,
  upstream: [],
  cohort: [],
  baseline: '',
  outcomes: [],
  feedback: [],
})

export const deliveryConfig = (dir: string) =>
  crustConfigSchema.parse({
    defaults: { data_dir: join(dir, 'data'), protected_files: [] },
    observability: {},
    agents: [],
  })

export const failingCommitHook = (dir: string): string => {
  const hook = join(dir, '.git', 'hooks', 'pre-commit')
  writeFileSync(hook, '#!/bin/sh\necho "commit refused by hook" >&2\nexit 1\n')
  chmodSync(hook, 0o755)
  return hook
}

export const refuseBuildCommit = async (
  run: TRun,
  message = 'fix: retain every delivery change\n\nKeep the whole commit message.',
): Promise<string> => {
  writeFileSync(join(run.repoRoot, 'work.txt'), 'after\n')
  const hook = failingCommitHook(run.repoRoot)
  const activityRunId = await runActivityRun(run)(
    activityRunParams({
      name: 'build',
      kind: 'agent',
      owner: 'build',
      description: 'Implement the change',
    }),
    (handle) => {
      run.tracer.event({
        run_id: run.runId,
        activity_run_id: handle.activityRun.activity_run_id,
        type: 'log',
        name: PATHS_TOUCHED,
        payload: observedPayload({
          activity: 'build',
          activityRunId: handle.activityRun.activity_run_id,
          agent: 'build',
          touched: ['work.txt'],
          dirtyBefore: [],
          claimed: ['work.txt'],
        }),
      })
      return handle.activityRun.activity_run_id
    },
  )
  commitActivity(
    run,
    'build',
    activityRunId,
    buildOutputSchema.parse({
      status: 'success',
      summary: 'Implemented the change',
      artifacts: [],
      notes_for_next_agent: '',
      facts: [],
      decisions: [],
      assumptions: [],
      unresolved: [],
      risks: [],
      objective_met: { met: true, evidence: 'fixture' },
      regress_to: { activity: '', because: '' },
      changed_files: ['work.txt'],
      commit_message: message,
    }),
    'implement',
  )
  return hook
}

export const deliveryFixture = () => {
  const dir = realpathSync(
    mkdtempSync(join(tmpdir(), 'crust-terminal-delivery-')),
  )
  const cwd = process.cwd()
  const dataDir = process.env.CRUST_DATA_DIR
  // biome-ignore lint/plugin/no-object-mutation: isolate createRun's environment path override and restore it on disposal
  process.env.CRUST_DATA_DIR = ''
  gitIn(dir, 'init', '-q', '-b', 'main')
  gitIn(dir, 'config', 'user.name', 'tester')
  gitIn(dir, 'config', 'user.email', 'tester@example.test')
  gitIn(dir, 'config', 'commit.gpgsign', 'false')
  gitIn(dir, 'config', 'core.hooksPath', join(dir, '.git', 'hooks'))
  writeFileSync(join(dir, 'work.txt'), 'before\n')
  gitIn(dir, 'add', '--', 'work.txt')
  gitIn(dir, 'commit', '-qm', 'fixture baseline')
  mkdirSync(join(dir, '.pi-crust'))
  process.chdir(dir)
  silenceTerminal()
  const cfg = deliveryConfig(dir)
  const tracer = createTracer(
    join(cfg.defaults.data_dir, 'crust.db'),
    join(dir, 'events.jsonl'),
  )
  const run = createRun({ cfg, runId: 'eecc125a', tracer, engineer: 'tester' })
  tracer.sessionStart(run.runId, run.engineer, 'deliver')
  return {
    dir,
    run,
    build: () =>
      runActivityRun(run)(
        activityRunParams({
          name: 'build',
          kind: 'agent',
          owner: 'build',
          description: 'Implement the change',
        }),
        () => undefined,
      ),
    [Symbol.dispose]: () => {
      tracer.close()
      restoreTerminal()
      process.chdir(cwd)
      if (dataDir === undefined) delete process.env.CRUST_DATA_DIR
      // biome-ignore lint/plugin/no-object-mutation: restore the environment owned by this fixture
      else process.env.CRUST_DATA_DIR = dataDir
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
