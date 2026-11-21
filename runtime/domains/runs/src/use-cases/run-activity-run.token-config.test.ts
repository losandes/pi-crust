import { expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crustConfigSchema } from '../../../../lib/contracts'
import { plain } from '../../../../lib/terminal'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import {
  restoreTerminal,
  silenceTerminal,
  terminalOutput,
} from '../../../../testing/terminal-capture'
import { createTracer } from '../../../trace'
import { createRun } from './create-run'
import { finish } from './run-activity-run'

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/run-activity-run::finish with token configuration',
    'when the run finishes',
    'it should print the absolute store path its tracer wrote to',
  ].join(', '),
  () => {
    // given
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'ct-')))
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

      // when
      finish(run, { accepted: true })
      const actual = plain(terminalOutput())

      // then
      expect(actual).not.toContain('{primary_worktree}')
      expect(actual.replace(/[│\s]/g, '')).toContain(tracer.dbPath)
    } finally {
      restoreTerminal()
      tracer.close()
      rmSync(root, { recursive: true, force: true })
    }
  },
)
