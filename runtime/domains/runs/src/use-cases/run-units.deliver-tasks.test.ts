import { expect, test } from 'bun:test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { attemptLedger } from './attempts'
import { chainMoments } from './moment-tasks'
import { runUnits } from './run-activities'
import {
  context,
  fixture,
  observe,
  serial,
  writer,
} from './run-units.moments-fixture.test'

test.skipIf(SKIP_INTEGRATION)(
  [
    'given @SC6 a last writer followed by review and a failing deliver task',
    'when the writer repairs the failure',
    'it should return once with private feedback, rerun review and spend one attempt',
  ].join(', '),
  async () => {
    // given
    using f = fixture({
      verify: {
        when: [{ on: 'deliver' }],
        run: "printf '%s\\n' {{changed_paths}}; test ! -f fail",
      },
    })
    writeFileSync(join(f.run.repoRoot, 'fail'), '')
    const seen = new Map<string, readonly (readonly string[])[]>()
    const capture = (name: string, feedback: readonly string[]) =>
      seen.set(name, [...(seen.get(name) ?? []), feedback])
    const build = writer(
      'build',
      ({ feedback, run }) => {
        capture('build', feedback)
        if (feedback.length > 0) rmSync(join(run.repoRoot, 'fail'))
      },
      { paths: ['a.ts'] },
    )
    const review = writer('review', ({ feedback }) => {
      capture('review', feedback)
    })
    const ledger = attemptLedger()
    // when
    const actual = await runUnits({
      run: f.run,
      units: serial([build, review]),
      start: context(f.run),
      moments: chainMoments(f.run),
      ledger,
    })
    // then
    expect(actual.outcomes.at(-1)?.accepted).toBe(true)
    expect(seen.get('build')?.[1]?.[0]).toContain('task verify:')
    expect(seen.get('review')).toEqual([[], []])
    expect(ledger.causes('build')).toEqual([
      'first attempt',
      'deliver task(s) failed: verify',
    ])
    expect(
      f.run.tracer
        .eventsNamed(f.run.runId, 'task:verify')
        .map((event) => event.passed),
    ).toEqual([false, true])
    expect(f.run.tracer.eventsNamed(f.run.runId, 'task_end')).toMatchObject([
      { moment: 'deliver', passed: false },
      { moment: 'deliver', passed: true },
    ])
    expect(f.run.tracer.eventsNamed(f.run.runId, 'chain_run')).toHaveLength(4)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given @SC7 a writer with no attempts left',
    'when deliver fails',
    'it should block without an extra execution and name every failed task',
  ].join(', '),
  async () => {
    // given
    using f = fixture({
      first: { when: [{ on: 'deliver' }], run: 'false' },
      second: { when: [{ on: 'deliver' }], run: 'false' },
    })
    const reasons = new Map<string, string>()
    const ledger = attemptLedger()
    // when
    const actual = await runUnits({
      run: f.run,
      units: serial([
        writer('build', undefined, { attempts: 1, paths: ['a.ts'] }),
      ]),
      start: context(f.run),
      moments: chainMoments(f.run),
      ledger,
      onTasksBlocked: (blocked) => {
        reasons.set('blocked', blocked.reason)
      },
    })
    // then
    expect(actual.outcomes.at(-1)).toEqual({
      activity: 'tasks:deliver',
      accepted: false,
    })
    expect(reasons.get('blocked')).toContain(
      "deliver task(s) first, second failed and 'build' has no attempts left",
    )
    expect(ledger.spent('build')).toBe(1)
    expect(f.run.tracer.eventsNamed(f.run.runId, 'regression')).toEqual([])
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given @SC13 a replayed writer and a deliver task',
    'when reaching the end of the resumed fold',
    'it should evaluate deliver without tagging or spending the replay',
  ].join(', '),
  async () => {
    // given
    using f = fixture({ verify: { when: [{ on: 'deliver' }], run: 'true' } }, [
      'build',
    ])
    writeFileSync(join(f.run.repoRoot, 'a.ts'), '')
    observe(f.run, 'build', '', ['a.ts'])
    const ledger = attemptLedger()
    // when
    await runUnits({
      run: f.run,
      units: serial([
        writer('build', () => {
          throw new Error('must replay')
        }),
      ]),
      start: context(f.run),
      moments: chainMoments(f.run),
      ledger,
    })
    // then
    expect(f.run.tracer.eventsNamed(f.run.runId, 'task:verify')).toHaveLength(1)
    expect(f.run.tracer.eventsNamed(f.run.runId, 'chain_run')).toEqual([])
    expect(ledger.spent('build')).toBe(0)
  },
)
