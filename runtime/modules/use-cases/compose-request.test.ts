import { expect, test } from 'bun:test'
import { TRUST_DEFAULT } from '../typedefs/trust'
import { OPERATORS, resumeArgvFor, runArgv } from './compose-request'

const SDLC_ACTIVITIES = ['plan', 'test', 'build', 'review']

const request = (over: Partial<Parameters<typeof runArgv>[0]> = {}) =>
  runArgv({
    lifecycle: 'sdlc',
    operator: '',
    activities: SDLC_ACTIVITIES,
    prompt: 'add a /health endpoint',
    // The default, named rather than spelled: this helper exists to produce
    // a request where nothing was chosen, and a literal here would start
    // emitting --trust-level the day the default moves.
    trustLevel: TRUST_DEFAULT,
    commit: true,
    approveAfter: '',
    stream: false,
    ...over,
  })

test(
  [
    'given use-cases/compose-request::runArgv',
    'when every answer is the default',
    'it should omit the flags, so the line can be read for intent',
  ].join(' '),
  () => {
    // given
    const defaults = {}

    // when
    const argv = request(defaults)

    // then
    expect(argv).toEqual([
      'just',
      'crust',
      'run',
      'add a /health endpoint',
      '--lifecycle',
      'sdlc',
    ])
  },
)

test(
  [
    'given use-cases/compose-request::runArgv',
    'when the activities are an arbitrary subset',
    'it should pass --activities in the order chosen',
  ].join(' '),
  () => {
    // given
    const activities = ['build', 'plan', 'test']

    // when — a hand-picked list is not a Lifecycle, named or otherwise
    const argv = request({ activities, lifecycle: '' })

    // then
    expect(argv.slice(0, 3)).toEqual(['just', 'crust', 'run'])
    expect(argv[argv.indexOf('--activities') + 1]).toBe('build,plan,test')
  },
)

test(
  [
    'given use-cases/compose-request::runArgv',
    'when a named lifecycle is chosen',
    'it should NOT pass --activities, so the run has one source of truth',
  ].join(' '),
  () => {
    // given
    const activities = SDLC_ACTIVITIES

    // when
    const argv = request({ activities })

    // then
    expect(argv).not.toContain('--activities')
  },
)

test(
  [
    'given use-cases/compose-request::runArgv',
    'when trust, committing, an approval point and streaming are all set',
    'it should carry every one of them',
  ].join(' '),
  () => {
    // given
    const answers = {
      trustLevel: 100,
      commit: false,
      approveAfter: 'plan',
      stream: true,
    }

    // when
    const argv = request(answers)

    // then
    expect(argv.join(' ')).toContain('--trust-level 100')
    expect(argv.join(' ')).toContain('--commit false')
    expect(argv.join(' ')).toContain('--approve-after plan')
    expect(argv).toContain('--stream')
  },
)

test(
  [
    'given use-cases/compose-request::resumeArgvFor',
    'when approving',
    'it should carry no note, because approval says nothing further',
  ].join(' '),
  () => {
    // given
    const answer = { runId: 'a1b2c3d4', verb: 'approve' as const, note: '' }

    // when
    const argv = resumeArgvFor(answer)

    // then
    expect(argv).toEqual(['just', 'crust', 'approve', 'a1b2c3d4'])
  },
)

test(
  [
    'given use-cases/compose-request::resumeArgvFor',
    'when rejecting with a reason',
    'it should pass the reason as a note',
  ].join(' '),
  () => {
    // given
    const answer = {
      runId: 'a1b2c3d4',
      verb: 'reject' as const,
      note: 'wrong module',
    }

    // when
    const argv = resumeArgvFor(answer)

    // then
    expect(argv.slice(-2)).toEqual(['--note', 'wrong module'])
  },
)

test(
  [
    'given use-cases/compose-request::runArgv',
    'when an operator was chosen instead of a chain',
    'it should run the operator and pass NO chain, which it would refuse',
  ].join(' '),
  () => {
    // given
    const answers = { operator: 'operator', activities: [] }

    // when
    const argv = request(answers)

    // then
    expect(argv).toEqual([
      'just',
      'crust',
      'operator',
      'add a /health endpoint',
    ])
    expect(argv).not.toContain('--activities')
  },
)

test(
  [
    'given use-cases/compose-request::OPERATORS',
    'when a person is offered something to pick',
    'it should name the Planner separately, as it answers the whole question',
  ].join(' '),
  () => {
    // given
    const given = OPERATORS

    // when
    const names = given.map((operator) => operator.name)

    // then
    expect(names).toContain('operator')
  },
)
