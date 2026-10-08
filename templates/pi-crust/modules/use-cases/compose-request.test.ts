import { expect, test } from 'bun:test'
import { TRUST_DEFAULT } from '../typedefs/trust'
import {
  LIFECYCLES,
  OPERATORS,
  STEP_CHOICES,
  isNamedLifecycle,
  justArgv,
  resumeArgvFor,
  runArgv,
  scriptFor,
  shellLine,
} from './compose-request'

const SDLC_STEPS = LIFECYCLES[0]?.steps ?? []

const request = (over: Partial<Parameters<typeof runArgv>[0]> = {}) =>
  runArgv({
    lifecycle: 'sdlc',
    operator: '',
    steps: SDLC_STEPS,
    prompt: 'add a /health endpoint',
    // The default, named rather than spelled: this helper exists to produce
    // a request where nothing was chosen, and a literal here would start
    // emitting --trust-level the day the default moves.
    trustLevel: TRUST_DEFAULT,
    delivery: 'branch',
    approveAfter: '',
    stream: false,
    ...over,
  })

test(
  [
    'given use-cases/compose-request::scriptFor',
    'when the chosen steps are exactly a named lifecycle',
    'it should run that lifecycle, so the trace records the name not a chain',
  ].join(' '),
  () => {
    // given
    const steps = SDLC_STEPS

    // when
    const script = scriptFor(steps)

    // then
    expect(script).toBe('.pi-crust/lifecycles/sdlc.ts')
    expect(isNamedLifecycle(steps)).toBe(true)
  },
)

test(
  [
    'given use-cases/compose-request::scriptFor',
    'when the steps match a lifecycle but in a different order',
    'it should compose, because order is what a chain MEANS',
  ].join(' '),
  () => {
    // given
    const reversed = SDLC_STEPS.toReversed()

    // when
    const script = scriptFor(reversed)

    // then
    expect(script).toBe('.pi-crust/lifecycles/compose.ts')
  },
)

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
      'bun',
      '.pi-crust/lifecycles/sdlc.ts',
      'add a /health endpoint',
    ])
  },
)

test(
  [
    'given use-cases/compose-request::runArgv',
    'when the steps are an arbitrary subset',
    'it should compose and pass --steps in the order chosen',
  ].join(' '),
  () => {
    // given
    const steps = ['build', 'plan', 'verify']

    // when
    const argv = request({ steps })

    // then
    expect(argv).toContain('.pi-crust/lifecycles/compose.ts')
    expect(argv[argv.indexOf('--steps') + 1]).toBe('build,plan,verify')
  },
)

test(
  [
    'given use-cases/compose-request::runArgv',
    'when a named lifecycle is chosen',
    'it should NOT pass --steps, so the run has one source of truth',
  ].join(' '),
  () => {
    // given
    const steps = SDLC_STEPS

    // when
    const argv = request({ steps })

    // then
    expect(argv).not.toContain('--steps')
  },
)

test(
  [
    'given use-cases/compose-request::runArgv',
    'when trust, delivery, an approval point and streaming are all set',
    'it should carry every one of them',
  ].join(' '),
  () => {
    // given
    const answers = {
      trustLevel: 100,
      delivery: 'patch' as const,
      approveAfter: 'plan',
      stream: true,
    }

    // when
    const argv = request(answers)

    // then
    expect(argv.join(' ')).toContain('--trust-level 100')
    expect(argv.join(' ')).toContain('--deliver patch')
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
    expect(argv).toEqual(['bun', '.pi-crust/decide.ts', 'approve', 'a1b2c3d4'])
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
    'given use-cases/compose-request::shellLine',
    'when an argument contains spaces',
    'it should quote only that one, so the quoting itself carries meaning',
  ].join(' '),
  () => {
    // given
    const argv = ['bun', '.pi-crust/lifecycles/sdlc.ts', 'add a /health endpoint']

    // when
    const line = shellLine(argv)

    // then
    expect(line).toBe(
      'bun .pi-crust/lifecycles/sdlc.ts "add a /health endpoint"',
    )
  },
)

test(
  [
    'given use-cases/compose-request::justArgv',
    'when the command runs a named lifecycle',
    'it should become the recipe, which is the documented way to say it',
  ].join(' '),
  () => {
    // given
    const argv = [
      'bun',
      '.pi-crust/lifecycles/sdlc.ts',
      'add a /health endpoint',
      '--trust-level',
      '50',
    ]

    // when
    const recipe = justArgv(argv)

    // then
    expect(recipe).toEqual([
      'just',
      'crust',
      'sdlc',
      'add a /health endpoint',
      '--trust-level',
      '50',
    ])
  },
)

test(
  [
    'given use-cases/compose-request::justArgv',
    'when the command runs a single stage',
    'it should become that stage recipe',
  ].join(' '),
  () => {
    // given
    const argv = ['bun', '.pi-crust/stages/code-review.ts', 'the /health work']

    // when
    const recipe = justArgv(argv)

    // then
    expect(recipe).toEqual(['just', 'crust', 'code-review', 'the /health work'])
  },
)

test(
  [
    'given use-cases/compose-request::justArgv',
    'when the command answers a gate',
    'it should use the verb as the recipe, because there is one per verb',
  ].join(' '),
  () => {
    // given
    const argv = [
      'bun',
      '.pi-crust/decide.ts',
      'answer',
      'a1b2c3d4',
      '--note',
      'the l4-proxy owns it',
    ]

    // when
    const recipe = justArgv(argv)

    // then
    expect(recipe).toEqual([
      'just',
      'crust',
      'answer',
      'a1b2c3d4',
      '--note',
      'the l4-proxy owns it',
    ])
  },
)

test(
  [
    'given use-cases/compose-request::justArgv',
    'when nothing in the recipes matches the script',
    'it should hand back the runnable line rather than invent a recipe',
  ].join(' '),
  () => {
    // given
    const argv = ['bun', '.pi-crust/some-new-entry.ts', 'x']

    // when
    const recipe = justArgv(argv)

    // then
    expect(recipe).toEqual(argv)
  },
)

test(
  [
    'given use-cases/compose-request::justArgv',
    'when a composed chain carries its steps',
    'it should keep every flag in place after the recipe name',
  ].join(' '),
  () => {
    // given
    const argv = [
      'bun',
      '.pi-crust/lifecycles/compose.ts',
      'fix the redirect',
      '--steps',
      'build,plan',
    ]

    // when
    const line = justArgv(argv).join(' ')

    // then
    expect(line).toBe(
      'just crust compose fix the redirect --steps build,plan',
    )
  },
)

test(
  [
    'given use-cases/compose-request::runArgv',
    'when an operator was chosen instead of a chain',
    'it should run the operator and pass NO steps, which it would refuse',
  ].join(' '),
  () => {
    // given
    const answers = { operator: 'operator', steps: [] }

    // when
    const argv = request(answers)

    // then
    expect(argv).toEqual([
      'bun',
      '.pi-crust/stages/operator.ts',
      'add a /health endpoint',
    ])
    expect(argv).not.toContain('--steps')
  },
)

test(
  [
    'given use-cases/compose-request::STEP_CHOICES',
    'when a person is offered the steps to pick from',
    'it should not offer an operator among them, as that answers the whole question',
  ].join(' '),
  () => {
    // given
    const offered = STEP_CHOICES

    // when
    const names = OPERATORS.map((operator) => operator.name)

    // then
    expect(names).toContain('operator')
    expect(offered).not.toContain('operator')
    expect(offered).toContain('plan')
  },
)
