import { expect, test } from 'bun:test'
import { parseAge, pruneVerdict, type TPrunable, workspacesIn } from './prune'

const DAY = 86_400_000
const NOW = Date.parse('2026-03-01T00:00:00.000Z')

const run = (
  runId: string,
  status: string,
  daysAgo: number | undefined,
): TPrunable => ({
  run_id: runId,
  status,
  started_at:
    daysAgo === undefined ? null : new Date(NOW - daysAgo * DAY).toISOString(),
})

test(
  [
    'given use-cases/prune::parseAge',
    'when an age is given in days or hours',
    'it should read both',
  ].join(', '),
  () => {
    // given
    const forms = ['14d', '36h', '90']

    // when
    const actual = forms.map((form) => parseAge(form))

    // then — a bare number is days, because that is what anyone means
    expect(actual).toEqual([14 * DAY, 36 * 3_600_000, 90 * DAY])
  },
)

test(
  [
    'given use-cases/prune::parseAge',
    'when no age is given at all',
    'it should refuse rather than defaulting to something',
  ].join(', '),
  () => {
    // given — a bare `prune` must never be able to mean "everything"
    const missing = undefined

    // when
    const actual = parseAge(missing)

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given use-cases/prune::pruneVerdict',
    'when a run is old but still waiting for a person',
    'it should be spared',
  ].join(', '),
  () => {
    // given — a waiting run is old BECAUSE it is waiting for you, so age is
    // the worst possible reason to delete it
    const runs = [run('old-waiting', 'waiting', 90)]

    // when
    const actual = pruneVerdict(runs, 14 * DAY, NOW)

    // then
    expect(actual.doomed).toEqual([])
    expect(actual.spared[0]?.because).toContain('waiting')
  },
)

test(
  [
    'given use-cases/prune::pruneVerdict',
    'when a run is still running',
    'it should be spared however old its start time is',
  ].join(', '),
  () => {
    // given — a long build is not an abandoned one
    const runs = [run('long', 'running', 30)]

    // when
    const actual = pruneVerdict(runs, 14 * DAY, NOW)

    // then
    expect(actual.doomed).toEqual([])
  },
)

test(
  [
    'given use-cases/prune::pruneVerdict',
    'when a finished run is older than the cutoff',
    'it should be chosen, and a younger one left alone',
  ].join(', '),
  () => {
    // given
    const runs = [run('ancient', 'success', 40), run('recent', 'fail', 2)]

    // when
    const actual = pruneVerdict(runs, 14 * DAY, NOW)

    // then — failure is not a reason to keep a run forever; age is the rule
    expect(actual.doomed).toEqual(['ancient'])
  },
)

test(
  [
    'given use-cases/prune::pruneVerdict',
    'when a row has no start time',
    'it should be spared rather than treated as infinitely old',
  ].join(', '),
  () => {
    // given — a missing timestamp is damage, and the safe reading of damage
    // is "leave it alone"
    const runs = [run('damaged', 'success', undefined)]

    // when
    const actual = pruneVerdict(runs, 1 * DAY, NOW)

    // then
    expect(actual.doomed).toEqual([])
    expect(actual.spared[0]?.because).toContain('no start time')
  },
)

test(
  [
    'given use-cases/prune::workspacesIn',
    'when sessions come from several working trees',
    'it should name each one once, sorted, with nulls dropped',
  ].join(', '),
  () => {
    // given
    const runs = [
      { workspace_root: '/home/dev/pi-crust-issue-9' },
      { workspace_root: '/home/dev/pi-crust' },
      { workspace_root: '/home/dev/pi-crust' },
      { workspace_root: null },
      { workspace_root: undefined },
    ]

    // when
    const actual = workspacesIn(runs)

    // then
    expect(actual).toEqual(['/home/dev/pi-crust', '/home/dev/pi-crust-issue-9'])
  },
)
