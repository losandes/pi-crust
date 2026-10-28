import { expect, test } from 'bun:test'
import type { TEnvelopeBase } from '../typedefs/envelope'
import type { TRun } from '../typedefs/run'
import { renderWarnings } from '../typedefs/warning'
import type { TObservedPaths } from './observed-paths'
import {
  claimedPaths,
  observationsIn,
  observedPayload,
  PATHS_TOUCHED,
  touchedBy,
  unexpectedIn,
  unexpectedWarnings,
} from './observed-paths'

const observed = (
  overrides: Partial<TObservedPaths> & Readonly<{ activity: string }>,
): TObservedPaths => ({
  activityRunId: `id_${overrides.activity}`,
  agent: overrides.activity,
  touched: [],
  dirtyBefore: [],
  claimed: [],
  ...overrides,
})

/** A run whose trace already holds these observations, in this order. */
const runWith = (observations: readonly TObservedPaths[]): TRun =>
  ({
    runId: 'aaaa1111',
    tracer: {
      eventsNamed: (_runId: string, name: string) =>
        name === PATHS_TOUCHED ? observations.map(observedPayload) : [],
    },
  }) as unknown as TRun

test(
  [
    'given use-cases/observed-paths::unexpectedIn',
    'when a path changed that was neither already dirty nor reported',
    'it should be the only one worth saying out loud',
  ].join(', '),
  () => {
    /*
     * given — `touched` alone warns about a developer's unrelated edits
     * forever; `touched - claimed` alone warns about everything that was
     * already dirty before the Activity started, which is the same noise.
     */
    const given = observed({
      activity: 'build',
      touched: ['src/add.ts', 'src/known.ts', 'docs/mine.md'],
      claimed: ['src/known.ts'],
      dirtyBefore: ['docs/mine.md'],
    })

    // when
    const actual = unexpectedIn(given)

    // then
    expect(actual).toEqual(['src/add.ts'])
  },
)

test(
  [
    'given use-cases/observed-paths::unexpectedWarnings',
    'when a serial Activity changed something it never reported',
    'it should raise one warning naming that Activity and its Activity Run',
  ].join(', '),
  () => {
    // given
    const given = [
      observed({ activity: 'build', touched: ['src/add.ts'], claimed: [] }),
    ]

    // when
    const actual = unexpectedWarnings({
      stage: 'implement',
      concurrent: false,
      observations: given,
    })

    // then
    expect(actual).toEqual([
      {
        kind: 'unexpected',
        activities: ['build'],
        activityRunIds: ['id_build'],
        stage: 'implement',
        paths: ['src/add.ts'],
        note: '',
      },
    ])
  },
)

test(
  [
    'given use-cases/observed-paths::unexpectedWarnings',
    'when the same path changed during a concurrent Stage',
    'it should raise one warning for the Stage, not one per Activity',
  ].join(', '),
  () => {
    /*
     * given — the path is exactly as unattributable between two siblings as
     * it is between an agent and a developer, so two warnings would be two
     * copies of an answer nobody can act on.
     */
    const given = [
      observed({ activity: 'review', touched: ['notes.md'] }),
      observed({ activity: 'code-review', touched: ['notes.md'] }),
    ]

    // when
    const actual = unexpectedWarnings({
      stage: 'accept',
      concurrent: true,
      observations: given,
    })

    // then
    expect(actual).toHaveLength(1)
    expect(actual[0]?.paths).toEqual(['notes.md'])
    expect(actual[0]?.activities).toEqual(['review', 'code-review'])
  },
)

test(
  [
    'given use-cases/observed-paths::unexpectedWarnings',
    'when everything that changed was already dirty or was reported',
    'it should raise nothing at all',
  ].join(', '),
  () => {
    // given
    const given = [
      observed({
        activity: 'build',
        touched: ['src/known.ts', 'docs/mine.md'],
        claimed: ['src/known.ts'],
        dirtyBefore: ['docs/mine.md'],
      }),
    ]

    // when
    const actual = unexpectedWarnings({
      stage: 'implement',
      concurrent: false,
      observations: given,
    })

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/observed-paths::unexpectedWarnings',
    'when a gate failure made an Activity run twice',
    'it should judge the attempt that stands, not the one it superseded',
  ].join(', '),
  () => {
    // given — the first attempt's unreported file was reported by the second
    const given = [
      observed({ activity: 'build', touched: ['src/add.ts'], claimed: [] }),
      observed({
        activity: 'build',
        touched: ['src/add.ts'],
        claimed: ['src/add.ts'],
      }),
    ]

    // when
    const actual = unexpectedWarnings({
      stage: 'implement',
      concurrent: false,
      observations: given,
    })

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/observed-paths::touchedBy',
    'when an Activity ran more than once',
    'it should carry every path it was observed to change, across attempts',
  ].join(', '),
  () => {
    /*
     * given — a gate failure re-runs the Activity as a NEW Activity Run. The
     * file its first attempt wrote and its second did not touch again is
     * still that Activity's work, and leaving it out would leave it for the
     * next Activity to commit under the wrong message.
     */
    const run = runWith([
      observed({ activity: 'build', touched: ['src/first.ts'] }),
      observed({ activity: 'build', touched: ['src/second.ts'] }),
      observed({ activity: 'review', touched: ['reviews/r.md'] }),
    ])

    // when
    const actual = touchedBy(run, 'build')

    // then
    expect(actual).toEqual(['src/first.ts', 'src/second.ts'])
  },
)

test(
  [
    'given use-cases/observed-paths::observationsIn',
    'when a trace was written before the comparison existed',
    'it should read the paths it does have rather than refuse the record',
  ].join(', '),
  () => {
    // given — an older payload carries `paths` and nothing else
    const run = {
      runId: 'aaaa1111',
      tracer: {
        eventsNamed: () => [{ agent: 'build', paths: ['src/a.ts'] }],
      },
    } as unknown as TRun

    // when
    const actual = observationsIn(run)

    // then
    expect(actual[0]?.touched).toEqual(['src/a.ts'])
    expect(actual[0]?.dirtyBefore).toEqual([])
    expect(actual[0]?.claimed).toEqual([])
  },
)

test(
  [
    'given typedefs/warning::renderWarnings',
    'when a run raised an unexpected change',
    'it should say pi-crust cannot tell whose it was, and that nothing was undone',
  ].join(', '),
  () => {
    /*
     * given — a message implying attribution would teach developers to
     * distrust the warning, because half the time the change is theirs.
     */
    const given = [
      {
        kind: 'unexpected' as const,
        activities: ['build'],
        activityRunIds: ['id_build'],
        stage: 'implement',
        paths: ['src/add.ts', 'docs/notes.md'],
        note: '',
      },
    ]

    // when
    const actual = renderWarnings(given).join('\n')

    // then
    expect(actual).toContain('2 unexplained change(s)')
    expect(actual).toContain('- src/add.ts')
    expect(actual).toContain('pi-crust cannot tell')
    expect(actual).toContain('Nothing was changed back')
  },
)

test(
  [
    'given typedefs/warning::renderWarnings',
    'when a run raised nothing',
    'it should print nothing at all, rather than an encouraging empty heading',
  ].join(', '),
  () => {
    // given, when
    const actual = renderWarnings([])

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/observed-paths::claimedPaths',
    'when the Activity declared its work in `artifacts` rather than `changed_files`',
    'it should still count as claimed, so doing the job is not an unexplained change',
  ].join(', '),
  () => {
    /*
     * given — a Planner's contract has no `changed_files`. Reading that field
     * alone made every path it wrote unaccounted for, which warned about the
     * system working exactly as asked.
     */
    const given = {
      artifacts: ['specs/aaaa1111_divide-function.md'],
      summary: '',
    } as unknown as TEnvelopeBase

    // when
    const actual = claimedPaths('/repo', given)

    // then
    expect(actual).toEqual(['specs/aaaa1111_divide-function.md'])
  },
)

test(
  [
    'given use-cases/observed-paths::claimedPaths',
    'when an artifact is declared by the absolute path the agent was handed',
    'it should read as the repo-relative path git reports, not a second file',
  ].join(', '),
  () => {
    // given
    const given = {
      changed_files: ['src/add.ts'],
      artifacts: ['/repo/docs/notes.md', '/elsewhere/handoff/plan.md'],
      summary: '',
    } as unknown as TEnvelopeBase

    // when
    const actual = claimedPaths('/repo', given)

    // then — outside the repository keeps its absolute spelling, which no
    // path git reports can match, and that is the honest answer for it.
    expect(actual).toEqual([
      'src/add.ts',
      'docs/notes.md',
      '/elsewhere/handoff/plan.md',
    ])
  },
)
