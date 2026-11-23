import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activityRunParams, crustConfigSchema } from '../../../../lib/contracts'
import {
  restoreTerminal,
  silenceTerminal,
  terminalOutput,
} from '../../../../testing/terminal-capture'
import { createTracer } from '../../../trace'
import { createRun } from './create-run'
import { runActivityRun } from './run-activity-run'

test(
  [
    'given a run with a real tracer and console',
    'when an Activity Run body throws',
    'it should rethrow without printing the workflow completion panel',
  ].join(', '),
  async () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-failure-panel-'))
    const tracer = createTracer(
      join(dir, 'crust.db'),
      join(dir, 'events.jsonl'),
    )
    tracer.sessionStart('aaaa1111', 'tester', 'compose')
    const run = createRun({
      cfg: crustConfigSchema.parse({
        defaults: { data_dir: join(dir, 'data') },
        agents: [],
        observability: {},
      }),
      runId: 'aaaa1111',
      tracer,
      engineer: 'tester',
    })
    const error = new Error('body failed')
    silenceTerminal()
    try {
      // when, then
      await expect(
        runActivityRun(run)(
          activityRunParams({
            name: 'broken',
            kind: 'code',
            owner: 'tester',
            description: 'Exercise a failing Activity Run',
          }),
          () => {
            throw error
          },
        ),
      ).rejects.toBe(error)
      expect(terminalOutput()).not.toContain('pi-crust run complete')
      expect(
        tracer.activityRunsFor(run.runId).map(({ status }) => status),
      ).toEqual(['fail'])
    } finally {
      restoreTerminal()
      tracer.close()
      rmSync(dir, { recursive: true, force: true })
    }
  },
)
