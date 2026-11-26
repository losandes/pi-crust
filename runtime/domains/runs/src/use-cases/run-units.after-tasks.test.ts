import { expect, test } from 'bun:test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { contextEnvelopeSchema, genericOutput } from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { chainMoments } from './moment-tasks'
import { runUnits } from './run-activities'
import {
  CONTEXT,
  context,
  fixture,
  writer,
} from './run-units.moments-fixture.test'

test.skipIf(SKIP_INTEGRATION)(
  [
    'given @SC9 a concurrent sibling that has not settled',
    'when the other Activity completes',
    'it should not evaluate after until the sibling is released',
  ].join(', '),
  async () => {
    // given
    using f = fixture()
    const started = Promise.withResolvers<void>()
    const released = Promise.withResolvers<void>()
    const observed = new Set<string>()
    const sibling = writer('sibling', async () => {
      started.resolve()
      await released.promise
    })
    const moments = chainMoments(f.run)
    // when
    const execution = runUnits({
      run: f.run,
      units: [
        {
          stage: 'work',
          strategy: 'concurrent',
          activities: [writer('build'), sibling],
          endsStage: true,
        },
      ],
      start: context(f.run),
      moments: {
        ...moments,
        after: (stage) => {
          observed.add('after')
          return moments.after(stage)
        },
      },
    })
    await started.promise
    // then
    expect(observed.has('after')).toBe(false)
    released.resolve()
    await execution
    expect(observed.has('after')).toBe(true)
  },
)

for (const strategy of ['serial', 'concurrent'] as const) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given @SC9 ${strategy} writers with one selected by an after task`,
      'when the task fails once',
      'it should wait for siblings and retry only the selected writer in its original context',
    ].join(', '),
    async () => {
      // given
      using f = fixture({
        verify: {
          when: [{ after: 'build' }],
          match: ['*.ts'],
          run: 'test -f sibling && test ! -f fail',
        },
      })
      writeFileSync(join(f.run.repoRoot, 'fail'), '')
      const attempts = new Map<string, readonly string[]>()
      const base = writer(
        'build',
        ({ feedback, run, previousStep }) => {
          attempts.set('build', [
            ...(attempts.get('build') ?? []),
            previousStep ?? 'none',
          ])
          if (feedback.length > 0) rmSync(join(run.repoRoot, 'fail'))
        },
        { paths: ['a.ts'] },
      )
      const build = {
        ...base,
        execute: async (...args: Parameters<typeof base.execute>) => {
          await base.execute(...args)
          return {
            accepted: true,
            previous: genericOutput.schema.parse({
              status: 'success',
              summary: `build version ${attempts.get('build')?.length}`,
            }),
          }
        },
      }
      const docs = writer(
        'docs',
        ({ run }) => {
          attempts.set('docs', [...(attempts.get('docs') ?? []), 'done'])
          writeFileSync(join(run.repoRoot, 'sibling'), '')
        },
        { paths: ['docs.md'] },
      )
      const units =
        strategy === 'concurrent'
          ? [
              {
                stage: 'same',
                strategy,
                activities: [build, docs],
                endsStage: true,
              },
            ]
          : [
              {
                stage: 'same',
                strategy,
                activities: [build],
                endsStage: false,
              },
              { stage: 'same', strategy, activities: [docs], endsStage: true },
            ]
      // when
      const actual = await runUnits({
        run: f.run,
        units,
        start: context(f.run),
        moments: chainMoments(f.run),
      })
      // then
      expect(attempts.get('build')).toEqual(['none', 'none'])
      expect(attempts.get('docs')).toEqual(['done'])
      expect(
        actual.upstream.find((entry) => entry.activity === 'build')?.envelope
          .summary,
      ).toBe('build version 2')
      expect(
        f.run.tracer
          .eventsNamed(f.run.runId, 'task:verify')
          .map((event) => event.passed),
      ).toEqual([false, true])
      expect(f.run.tracer.eventsNamed(f.run.runId, 'chain_run')).toHaveLength(3)
      expect(f.run.activityRuns()[0]?.status).toBe('superseded')
    },
  )
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given an escalated Activity named by an after trigger and a writing sibling',
    'when settling their stage',
    'it should match the full stage but select no escalated paths',
  ].join(', '),
  async () => {
    // given
    using f = fixture({
      verify: {
        when: [{ after: 'build' }],
        run: "printf '%s\\n' {{changed_paths}}",
      },
    })
    const base = writer('build', undefined, { paths: ['a.ts'] })
    const escalated = {
      ...base,
      execute: async (...args: Parameters<typeof base.execute>) => {
        await base.execute(...args)
        return {
          accepted: true,
          previous: contextEnvelopeSchema.parse({
            ...CONTEXT,
            status: 'success',
            summary: 'Need an operator answer',
            unresolved: [
              {
                question: 'Which requirement?',
                consequential: true,
                beyond_this_run: false,
                provisional_answer: '',
              },
            ],
          }),
        }
      },
    }
    // when
    await runUnits({
      run: f.run,
      units: [
        {
          stage: 'work',
          strategy: 'concurrent',
          activities: [
            escalated,
            writer('docs', undefined, { paths: ['b.ts'] }),
          ],
          endsStage: true,
        },
        {
          stage: 'later',
          strategy: 'serial',
          activities: [writer('later')],
          endsStage: true,
        },
      ],
      start: context(f.run),
      moments: chainMoments(f.run),
    })
    // then
    expect(
      f.run.tracer.eventsNamed(f.run.runId, 'task:verify')[0],
    ).toMatchObject({ command: "printf '%s\\n' b.ts", instances: ['docs'] })
    expect(
      f.run.tracer.eventsNamed(f.run.runId, 'human_gate_open'),
    ).toHaveLength(1)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given @SC9 an after task that always fails and one attempt',
    'when settling its stage',
    'it should fail with the existing gate exhaustion error',
  ].join(', '),
  async () => {
    // given
    using f = fixture({ verify: { when: [{ after: 'build' }], run: 'false' } })
    // when, then
    await expect(
      runUnits({
        run: f.run,
        units: [
          {
            stage: 'build',
            strategy: 'serial',
            activities: [
              writer('build', undefined, { attempts: 1, paths: ['a.ts'] }),
            ],
            endsStage: true,
          },
        ],
        start: context(f.run),
        moments: chainMoments(f.run),
      }),
    ).rejects.toThrow('build failed its gates and has no attempts left')
    expect(f.run.activityRuns()[0]?.status).toBe('fail')
    expect(f.run.tracer.eventsNamed(f.run.runId, 'task_end')).toMatchObject([
      { moment: 'after', passed: false },
    ])
    expect(f.run.tracer.eventsNamed(f.run.runId, 'task_end')).toHaveLength(1)
  },
)
