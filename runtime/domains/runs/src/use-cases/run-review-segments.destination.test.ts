import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildOutputSchema,
  crustConfigSchema,
  reviewOutputSchema,
} from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import type { TAgentPorts } from '../../../activities'
import { runnableActivities } from '../../../activities'
import { emptyUsage } from '../../../agents'
import { asSingleStage, unitsFrom } from '../../../planning'
import { chainMoments, destinationOf } from './moment-tasks'
import { runReviewSegments } from './run-review-segments'
import { CONTEXT, context, fixture } from './run-units.moments-fixture.test'

test.skipIf(SKIP_INTEGRATION)(
  [
    'given repeated build and review groups whose second group rejects twice',
    'when the real revise loop re-asks its reviewer between revisions',
    'it should resolve the second nested writer through chain tags to build_2',
  ].join(', '),
  async () => {
    // given
    const entries = [
      { name: 'build', output: 'buildOutput', attempts: 4 },
      { name: 'code-review', output: 'reviewOutput', attempts: 4 },
    ].map((entry) => ({
      ...entry,
      purpose: `Exercise ${entry.name} through repeated review groups.`,
      model: `fixture/${entry.name}`,
      prompts: '.',
      writes: [],
    }))
    using f = fixture(
      {},
      [],
      crustConfigSchema.parse({ activities: entries }).activities,
    )
    writeFileSync(join(f.run.repoRoot, 'work.ts'), 'fixture')
    const cfg = crustConfigSchema.parse({ ...f.run.cfg, agents: entries })
    const run = { ...f.run, cfg }
    const attempts = new Map<string, number>()
    const ports: TAgentPorts = {
      run: (request) => {
        const name = request.model.slice('fixture/'.length)
        const attempt = (attempts.get(name) ?? 0) + 1
        attempts.set(name, attempt)
        const approved = attempt === 1 || attempt >= 4
        const envelope =
          name === 'build'
            ? buildOutputSchema.parse({
                ...CONTEXT,
                status: 'success',
                summary: `build ${attempt}`,
                changed_files: ['work.ts'],
              })
            : reviewOutputSchema.parse({
                ...CONTEXT,
                status: 'success',
                summary: `review ${attempt}`,
                approved,
                findings: approved
                  ? []
                  : [
                      {
                        requirement: `finding ${attempt}`,
                        met: false,
                        severity: 'major',
                        evidence: `work.ts:${attempt}`,
                      },
                    ],
                blocking: approved ? [] : [`finding ${attempt}`],
              })
        return Promise.resolve({
          text: JSON.stringify(envelope),
          returncode: 0,
          sessionId: 'fixture',
          tokens: 0,
          cost: 0,
          usage: emptyUsage,
          contextTokens: 0,
          contextWindow: 0,
        })
      },
      changed: () => [],
      untracked: () => [],
      render: (path) => path,
      savePrompt: (dir, name) => `${dir}/${name}`,
      snapshot: () => ({}),
      rev: () => '',
      head: () => '',
      history: () => () => [],
      content: () => ({ status: 'ok', data: {} }),
    }
    const names = ['build', 'code-review', 'build', 'code-review']
    const units = unitsFrom(
      asSingleStage(names),
      runnableActivities(names, cfg, { committing: false }, ports),
    )
    // when
    const actual = await runReviewSegments({
      run,
      names,
      units,
      start: context(run),
      moments: chainMoments(run),
      options: { committing: false },
      fallbackReason: 'fixture',
      agentPorts: ports,
    })
    const rows = run.tracer.activityRunsFor(run.runId)
    const revisions = rows.filter((row) => row.params.name === 'revise')
    const second = revisions[1]
    const tags = new Set(
      run.tracer
        .eventsNamed(run.runId, 'chain_run')
        .map((tag) => tag.activity_run_id),
    )
    const destination = destinationOf(
      run,
      units,
    )({
      instance: 'revise',
      activity: 'build',
      activityRunId: second?.activity_run_id ?? '',
    })
    // then
    expect(actual.accepted).toBe(true)
    expect(revisions).toHaveLength(2)
    expect(
      rows.some(
        (row) =>
          row.seq > (revisions[0]?.seq ?? 0) &&
          row.seq < (second?.seq ?? 0) &&
          row.params.name === 'code-review' &&
          !tags.has(row.activity_run_id),
      ),
    ).toBe(true)
    expect(destination?.activity.instance).toBe('build_2')
    expect(tags.size).toBe(4)
  },
)
