import { expect, test } from 'bun:test'
import type { TRegressionRecord } from './regression'
import { regressionVerdict, timesReturnedTo } from './regression'

const chain = ['identify', 'conceptualize', 'design', 'build', 'review']

const verdict = (
  fields: Partial<Parameters<typeof regressionVerdict>[0]>,
): ReturnType<typeof regressionVerdict> =>
  regressionVerdict({
    request: undefined,
    names: chain,
    askedAt: 2,
    history: [],
    attemptsLeft: 1,
    ...fields,
  })

test(
  [
    'given use-cases/regression::regressionVerdict',
    'when a POC disproves the architecture it was testing',
    'it should send the run back to the stage that proposed it',
  ].join(', '),
  () => {
    // given
    const request = {
      activity: 'conceptualize',
      because: 'the queue cannot preserve order across partitions; measured',
    }

    // when
    const actual = verdict({ request })

    // then — the whole point of a cheap experiment is being allowed to act on
    // a negative result, rather than carrying it forward into a build
    expect(actual).toEqual({ kind: 'regress', to: 'conceptualize', index: 1 })
  },
)

test(
  [
    'given use-cases/regression::regressionVerdict',
    'when no stage asked to go back',
    'it should say so, which is the ordinary answer',
  ].join(', '),
  () => {
    // given
    const request = undefined

    // when
    const actual = verdict({ request })

    // then
    expect(actual.kind).toBe('none')
  },
)

test(
  [
    'given use-cases/regression::regressionVerdict',
    'when a stage asks to return to one this chain does not run',
    'it should refuse and say what the chain does run',
  ].join(', '),
  () => {
    // given a chain composed without `design`
    const request = { activity: 'deploy', because: 'the schema is wrong' }

    // when
    const actual = verdict({ request })

    // then
    expect(actual.kind).toBe('refused')
    expect(actual.kind === 'refused' ? actual.reason : '').toContain(
      'does not',
    )
  },
)

test(
  [
    'given use-cases/regression::regressionVerdict',
    'when a stage asks to go FORWARD',
    'it should refuse, because that is just the next step',
  ].join(', '),
  () => {
    // given a poc (index 2) pointing at verify (index 4)
    const request = { activity: 'verify', because: 'run the checks first' }

    // when
    const actual = verdict({ request })

    // then
    expect(actual.kind).toBe('refused')
  },
)

test(
  [
    'given use-cases/regression::regressionVerdict',
    'when the destination has no attempts left in this run',
    'it should stop rather than pay for a lap nothing is budgeted for',
  ].join(', '),
  () => {
    // given — a lap IS an Activity Run of the destination, so it comes out
    // of that instance's `attempts`, like a gate retry and a revision
    const history: readonly TRegressionRecord[] = [
      { from: 'build', to: 'conceptualize', because: 'first time' },
    ]
    const request = { activity: 'conceptualize', because: 'still wrong' }

    // when
    const actual = verdict({ request, history, attemptsLeft: 0 })

    // then
    expect(actual.kind).toBe('exhausted')
    expect(actual.kind === 'exhausted' ? actual.reason : '').toContain(
      'still wrong',
    )
  },
)

test(
  [
    'given use-cases/regression::timesReturnedTo',
    'when the history returned to different stages',
    'it should count only the stage asked about',
  ].join(', '),
  () => {
    // given
    const history: readonly TRegressionRecord[] = [
      { from: 'build', to: 'design', because: 'a' },
      { from: 'build', to: 'conceptualize', because: 'b' },
      { from: 'review', to: 'design', because: 'c' },
    ]

    // when
    const actual = timesReturnedTo(history, 'design')

    // then
    expect(actual).toBe(2)
  },
)
