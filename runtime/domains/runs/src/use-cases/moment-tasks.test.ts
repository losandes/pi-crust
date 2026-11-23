import { expect, test } from 'bun:test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TRun } from '../../../../lib/contracts'
import { activityRunParams } from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import {
  chainMoments,
  destinationOf,
  lastWriter,
  persistedRowFor,
  runChangedPaths,
} from './moment-tasks'
import {
  context,
  fixture,
  observe,
  serial,
  writer,
} from './run-units.moments-fixture.test'

const row = (
  run: TRun,
  instance: string,
  seq: number,
  tagged = false,
): string => {
  const id = `row-${seq}`
  run.tracer.activityRunUpsert({
    activity_run_id: id,
    run_id: run.runId,
    seq,
    params: activityRunParams({
      name: instance,
      owner: instance,
      kind: 'agent',
      description: 'Record a fixture execution for destination resolution.',
    }),
    status: 'success',
    error: undefined,
    started_at: undefined,
    ended_at: undefined,
  })
  if (tagged)
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: id,
      type: 'log',
      name: 'chain_run',
      payload: { activity_run_id: id, instance },
    })
  return id
}

for (const scenario of [
  {
    name: 'known build_2',
    rows: [
      ['build', true],
      ['code-review', true],
      ['build_2', true],
    ],
    instance: 'build_2',
    expected: 'build_2',
  },
  {
    name: 'first group nested revision',
    rows: [
      ['build', true],
      ['code-review', true],
      ['revise-build', false],
    ],
    instance: 'revise-build',
    expected: 'build',
  },
  {
    name: 'second group revision after a colliding reviewer',
    rows: [
      ['build', true],
      ['code-review', true],
      ['build_2', true],
      ['code-review_2', true],
      ['revise', false],
      ['code-review', false],
      ['revise', false],
    ],
    instance: 'revise',
    expected: 'build_2',
  },
  {
    name: 'untagged trace',
    rows: [
      ['build', false],
      ['revise', false],
    ],
    instance: 'revise',
    expected: undefined,
  },
] as const) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given ${scenario.name}`,
      'when resolving the last writer over repeated review groups',
      'it should use chain provenance rather than row names',
    ].join(', '),
    () => {
      // given
      using f = fixture()
      const units = serial([
        writer('build'),
        writer('code-review'),
        writer('build_2', undefined, { name: 'build' }),
        writer('code-review_2', undefined, { name: 'code-review' }),
      ])
      const ids = scenario.rows.map(([name, tag], at) =>
        row(f.run, name, at + 1, tag),
      )
      // when
      const actual = destinationOf(
        f.run,
        units,
      )({
        instance: scenario.instance,
        activity: 'build',
        activityRunId: ids.at(-1) ?? '',
      })
      // then
      expect(actual?.activity.instance).toBe(scenario.expected)
      expect(
        destinationOf(
          f.run,
          units,
        )({ instance: 'build', activity: 'build', activityRunId: 'absent' }),
      ).toBeUndefined()
    },
  )
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given repository observations mixed with session and handoff artifacts',
    'when finding the whole change and its last writer',
    'it should remove internal paths but retain deleted repository paths and canonical ownership',
  ].join(', '),
  () => {
    // given
    using f = fixture()
    observe(f.run, 'build', 'one', ['a.ts', 'deleted.ts'])
    observe(
      f.run,
      'revise',
      'two',
      ['b.md', join(f.run.sessionDir, 'session.json')],
      'build',
    )
    observe(f.run, 'plan', 'three', [join(f.run.contextHandoffDir, 'plan.md')])
    // when
    const paths = runChangedPaths(f.run)
    const last = lastWriter(f.run)
    // then
    expect(paths).toEqual(['a.ts', 'deleted.ts', 'b.md'])
    expect(last).toEqual({
      instance: 'revise',
      activity: 'build',
      activityRunId: 'two',
    })
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given @SC4 an earlier TypeScript change, a deleted file and a later documentation writer',
    'when deliver evaluates the whole run',
    'it should select only existing matching paths and record the persisted writer row',
  ].join(', '),
  async () => {
    // given
    using f = fixture({
      verify: {
        when: [{ on: 'deliver' }],
        match: ['*.ts'],
        run: "printf '%s\\n' {{base_ref}} {{changed_paths}}",
      },
    })
    writeFileSync(join(f.run.repoRoot, 'a.ts'), '')
    writeFileSync(join(f.run.repoRoot, 'deleted.ts'), '')
    observe(f.run, 'build', row(f.run, 'build', 1, true), [
      'a.ts',
      'deleted.ts',
    ])
    rmSync(join(f.run.repoRoot, 'deleted.ts'))
    writeFileSync(join(f.run.repoRoot, 'b.md'), '')
    const id = row(f.run, 'docs', 2, true)
    observe(f.run, 'docs', id, ['b.md'])
    // when
    const actual = await chainMoments(f.run).deliver(context(f.run))
    // then
    expect(actual.kind).toBe('pass')
    expect(
      f.run.tracer.eventsNamed(f.run.runId, 'task:verify')[0],
    ).toMatchObject({
      command: "printf '%s\\n' recorded-start a.ts",
      moment: 'deliver',
      instances: ['docs'],
    })
    expect(persistedRowFor(f.run)('docs')?.activity_run_id).toBe(id)
    expect(f.run.tracer.eventsNamed(f.run.runId, 'tasks:deliver')).toHaveLength(
      1,
    )
  },
)

for (const finalWriter of ['reproduce', 'build']) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given @SC5 deliver skips reproduce and ${finalWriter} wrote last`,
      'when evaluating deliver',
      'it should skip only for the last writer and record why',
    ].join(', '),
    async () => {
      // given
      using f = fixture({
        verify: {
          when: [{ on: 'deliver', skip: ['reproduce', 'unknown'] }],
          run: 'true',
        },
      })
      writeFileSync(join(f.run.repoRoot, 'a.ts'), '')
      observe(f.run, 'reproduce', row(f.run, 'reproduce', 1), ['a.ts'])
      if (finalWriter === 'build')
        observe(f.run, 'build', row(f.run, 'build', 2), ['a.ts'])
      // when
      const actual = await chainMoments(f.run).deliver(context(f.run))
      // then
      expect(actual.kind).toBe('pass')
      expect(f.run.tracer.eventsNamed(f.run.runId, 'task:verify')).toHaveLength(
        finalWriter === 'build' ? 1 : 0,
      )
      expect(f.run.tracer.eventsNamed(f.run.runId, 'task_skipped')).toEqual(
        finalWriter === 'build'
          ? []
          : [
              {
                task: 'verify',
                moment: 'deliver',
                instance: 'reproduce',
                activity: 'reproduce',
              },
            ],
      )
    },
  )
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given @SC4 no selected repository paths',
    'when evaluating deliver without a writer or with nonmatching files',
    'it should produce no task or gate record',
  ].join(', '),
  async () => {
    // given
    using f = fixture({
      verify: { when: [{ on: 'deliver' }], match: ['*.ts'], run: 'false' },
    })
    // when
    const empty = await chainMoments(f.run).deliver(context(f.run))
    writeFileSync(join(f.run.repoRoot, 'docs.md'), '')
    observe(f.run, 'docs', '', ['docs.md'])
    const unmatched = await chainMoments(f.run).deliver(context(f.run))
    // then
    expect(empty.kind).toBe('pass')
    expect(unmatched.kind).toBe('pass')
    expect(f.run.tracer.eventsNamed(f.run.runId, 'task:verify')).toEqual([])
    expect(f.run.tracer.eventsNamed(f.run.runId, 'tasks:deliver')).toEqual([])
  },
)
