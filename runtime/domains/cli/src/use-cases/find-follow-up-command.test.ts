import { expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activityRunParams, crustConfigSchema } from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { createTracer } from '../../../trace'
import { findFollowUpCommand } from './find-follow-up-command'

for (const one of [
  { name: 'token configuration', override: false, missing: false },
  { name: 'an overriding store', override: true, missing: false },
  { name: 'a missing run', override: false, missing: true },
]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given findFollowUpCommand with ${one.name}`,
      'when reading the triage recommendation',
      'it should return only the command recorded in the selected store',
    ].join(', '),
    () => {
      // given
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'crust-follow-up-')))
      const dbPath = one.override
        ? join(root, 'other', 'crust.db')
        : join(root, '.pi-crust', 'data', 'crust.db')
      const tracer = createTracer(dbPath, join(root, 'events.jsonl'))
      try {
        const activityRun = {
          activity_run_id: 'aaaa1111_01_triage',
          run_id: 'aaaa1111',
          seq: 1,
          params: activityRunParams({
            name: 'triage',
            kind: 'agent',
            owner: 'triage',
            description: 'Choose the chain',
          }),
          status: 'success' as const,
          error: undefined,
          started_at: undefined,
          ended_at: undefined,
        }
        tracer.sessionStart('aaaa1111', 'tester', 'triage')
        tracer.activityRunUpsert(activityRun)
        tracer.envelopeRow(
          activityRun,
          'triage',
          'OperatorPlanOutput',
          JSON.stringify({ steps: ['plan', 'build'] }),
          true,
        )
        const cfg = crustConfigSchema.parse({
          defaults: { data_dir: '{primary_worktree}/.pi-crust/data' },
          observability: { db: '{primary_worktree}/.pi-crust/data/crust.db' },
          agents: [],
        })
        const env = one.override ? { CRUST_DB: dbPath } : {}

        // when
        const actual = findFollowUpCommand({ repoRoot: root, env })(
          cfg,
          one.missing ? 'bbbb2222' : 'aaaa1111',
          'fix the paths',
        )

        // then
        expect(actual).toEqual(
          one.missing
            ? undefined
            : 'just crust run "fix the paths" --activities plan,build',
        )
      } finally {
        tracer.close()
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
}
