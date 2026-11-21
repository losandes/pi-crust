import { expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activityRunParams, crustConfigSchema } from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import { createTracer } from '../../../trace'
import { createRun } from './create-run'
import { recordStepResult, replayStepResult } from './resume'
import { runActivityRun } from './run-activity-run'

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/resume::replayStepResult with token configuration',
    'when a code activity records its verdict in the tracer store',
    'it should replay that payload from the same store',
  ].join(', '),
  async () => {
    // given
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), 'crust-replay-token-')),
    )
    const tracer = createTracer(
      join(root, 'crust.db'),
      join(root, 'events.jsonl'),
    )
    silenceTerminal()
    try {
      const original = createRun({
        cfg: crustConfigSchema.parse({
          defaults: { data_dir: join(root, 'data') },
          observability: { db: tracer.dbPath },
          agents: [],
        }),
        runId: 'aaaa1111',
        tracer,
        engineer: 'tester',
      })
      const run = {
        ...original,
        cfg: crustConfigSchema.parse({
          defaults: { data_dir: '{primary_worktree}/.pi-crust/data' },
          observability: { db: '{primary_worktree}/.pi-crust/data/crust.db' },
          agents: [],
        }),
      }
      tracer.sessionStart(run.runId, 'tester', 'sdlc')
      await runActivityRun(run)(
        activityRunParams({
          name: 'build',
          kind: 'code',
          owner: 'quality',
          description: 'Record a verdict',
        }),
        (handle) => recordStepResult(run, handle, { decision: 'approved' }),
      )

      // when
      const actual = replayStepResult(run, 'build')

      // then
      expect(actual).toEqual({ decision: 'approved' })
    } finally {
      restoreTerminal()
      tracer.close()
      rmSync(root, { recursive: true, force: true })
    }
  },
)
