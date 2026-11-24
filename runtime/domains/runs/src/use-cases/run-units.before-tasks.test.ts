import { expect, test } from 'bun:test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { contextEnvelopeSchema } from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { chainMoments } from './moment-tasks'
import { runUnits } from './run-activities'
import {
  CONTEXT,
  context,
  fixture,
  observe,
  serial,
  writer,
} from './run-units.moments-fixture.test'

// Allow subprocess startup and task retries under parallel suite load.
const INTEGRATION_TIMEOUT_MS = 20_000

test.skipIf(SKIP_INTEGRATION)(
  [
    'given @SC8 a failing before task ahead of concurrent reviewers',
    'when returning to the writer',
    'it should finish repair before any reviewer starts',
  ].join(', '),
  async () => {
    // given
    using f = fixture({
      verify: { when: [{ before: 'review' }], run: 'test ! -f fail' },
    })
    writeFileSync(join(f.run.repoRoot, 'fail'), '')
    const build = writer(
      'build',
      ({ feedback, run }) => {
        if (feedback.length > 0) rmSync(join(run.repoRoot, 'fail'))
      },
      { paths: ['a.ts'] },
    )
    const review = writer('review', ({ run }) => {
      expect(
        run.tracer.eventsNamed(run.runId, 'task:verify').at(-1)?.passed,
      ).toBe(true)
    })
    const sibling = writer('sibling')
    // when
    await runUnits({
      run: f.run,
      units: [
        ...serial([build]),
        {
          stage: 'reviews',
          strategy: 'concurrent',
          activities: [review, sibling],
          endsStage: true,
        },
      ],
      start: context(f.run),
      moments: chainMoments(f.run),
    })
    // then
    expect(f.run.activityRuns().map((row) => row.params.name)).toEqual([
      'build',
      'build',
      'review',
      'sibling',
    ])
    expect(
      f.run.tracer
        .eventsNamed(f.run.runId, 'task:verify')
        .map((event) => event.passed),
    ).toEqual([false, true])
  },
  INTEGRATION_TIMEOUT_MS,
)

for (const repeated of [false, true]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given @SC8 a regression whose last writer is ${repeated ? 'build_2 after the target stage' : 'second in the target stage'}`,
      'when before fails on re-entry over all observed files',
      'it should block without starting the stage or choosing an earlier namesake',
    ].join(', '),
    async () => {
      // given
      const firstName = repeated ? 'build' : 'first'
      const targetName = repeated ? 'gate' : 'second'
      const lastName = repeated ? 'build_2' : 'second'
      using f = fixture({
        verify: {
          when: [{ before: targetName }],
          run: "printf '%s\\n' {{changed_paths}}; test ! -f fail",
        },
      })
      const counts = new Map<string, number>()
      const change = (instance: string, path: string, marker: boolean) =>
        writer(
          instance,
          ({ run }, handle) => {
            const count = (counts.get(instance) ?? 0) + 1
            counts.set(instance, count)
            if (count !== 1) return
            writeFileSync(join(run.repoRoot, path), 'change')
            observe(
              run,
              instance,
              handle.activityRun.activity_run_id,
              [path],
              instance === 'build_2' ? 'build' : instance,
            )
            if (marker) writeFileSync(join(run.repoRoot, 'fail'), '')
          },
          { name: instance === 'build_2' ? 'build' : instance, attempts: 8 },
        )
      const first = change(firstName, 'a.ts', false)
      const last = change(lastName, 'b.ts', true)
      const judge = {
        ...writer(repeated ? 'judge' : 'third'),
        execute: async () => ({
          accepted: true,
          previous: contextEnvelopeSchema.parse({
            ...CONTEXT,
            status: 'success',
            summary: 'Return to the first writer',
            regress_to: { activity: firstName, because: 'fixture re-entry' },
          }),
        }),
      }
      const steps = repeated
        ? [first, writer(targetName), last, judge]
        : [first, last, judge]
      const blocked = new Map<string, string>()
      // when
      const actual = await runUnits({
        run: f.run,
        units: serial(steps),
        start: context(f.run),
        moments: chainMoments(f.run),
        onTasksBlocked: (entry) => {
          blocked.set('reason', entry.reason)
        },
      })
      // then
      const failed = f.run.tracer
        .eventsNamed(f.run.runId, 'task:verify')
        .find((event) => event.passed === false)
      expect(failed?.command).toContain('a.ts b.ts')
      expect(f.run.activityRuns().map((row) => row.params.name)).toEqual([
        ...steps.map((step) => step.instance),
        firstName,
      ])
      expect(blocked.get('reason')).toContain(
        `before task(s) verify failed and '${lastName}'`,
      )
      expect(blocked.get('reason')).toContain(
        'is not ahead of the stage being entered',
      )
      expect(actual.outcomes.at(-1)?.accepted).toBe(false)
      expect(counts.get(firstName)).toBe(2)
    },
    INTEGRATION_TIMEOUT_MS,
  )
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a replayed stage and a failing before task',
    'when resuming',
    'it should skip the obsolete precondition',
  ].join(', '),
  async () => {
    // given
    using f = fixture(
      { verify: { when: [{ before: 'review' }], run: 'false' } },
      ['review'],
    )
    writeFileSync(join(f.run.repoRoot, 'a.ts'), '')
    observe(f.run, 'build', '', ['a.ts'])
    // when
    await runUnits({
      run: f.run,
      units: serial([writer('review')]),
      start: context(f.run),
      moments: chainMoments(f.run),
    })
    // then
    expect(f.run.tracer.eventsNamed(f.run.runId, 'task:verify')).toEqual([])
  },
  INTEGRATION_TIMEOUT_MS,
)
