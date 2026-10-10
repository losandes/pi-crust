import { expect, test } from 'bun:test'
import type { TRunState } from '../typedefs/run-state'
import { adviceCommand, shellQuoted } from './advice'

const state = (
  payload: Readonly<Record<string, unknown>>,
  agent = 'triage',
  valid = true,
): TRunState =>
  ({
    run_id: 'a1b2c3d4',
    lifecycle: 'triage',
    request: '',
    status: 'ok',
    engineer: 'tester',
    started_at: undefined,
    ended_at: undefined,
    tokens: 0,
    cost: 0,
    phases: [],
    completed: [],
    resume_from: undefined,
    failed_gates: [],
    envelopes: [
      { phase: 'triage', agent, output_type: 'OperatorPlanOutput', valid, attempt: 1, payload },
    ],
  }) as TRunState

test(
  [
    'given use-cases/advice::adviceCommand',
    'when the triage chose a chain',
    'it should hand back the command that would run it',
  ].join(', '),
  () => {
    // given — the agent does not write this line. It chose steps; the shape
    // of the invocation belongs to the code that knows what compose takes,
    // and an agent guessing at flags produces something that fails on paste.
    const chosen = state({ steps: ['scout', 'conceptualize', 'design'] })

    // when
    const actual = adviceCommand(chosen, 'specs/stats.md')

    // then
    expect(actual).toEqual(
      'just crust compose "specs/stats.md" --steps scout,conceptualize,design',
    )
  },
)

test(
  [
    'given use-cases/advice::adviceCommand',
    'when the chain contains a name that is not a step',
    'it should drop it rather than print a command that cannot run',
  ].join(', '),
  () => {
    // given — the gate catches this first, but the trace can also hold a
    // chain written by an older factory whose steps have since been renamed
    const chosen = state({ steps: ['scout', 'teleport', 'design'] })

    // when
    const actual = adviceCommand(chosen, 'x')

    // then
    expect(actual).toEqual('just crust compose "x" --steps scout,design')
  },
)

test(
  [
    'given use-cases/advice::adviceCommand',
    'when no usable chain was chosen',
    'it should hand back nothing rather than an empty --steps',
  ].join(', '),
  () => {
    // given — a command that would start a run with no steps is not a
    // smaller recommendation, it is a broken one
    const empty = state({ steps: [] })
    const invalid = state({ steps: ['scout'] }, 'triage', false)
    const other = state({ steps: ['scout'] }, 'operator')

    // when
    const actual = [
      adviceCommand(empty, 'x'),
      adviceCommand(invalid, 'x'),
      adviceCommand(other, 'x'),
    ]

    // then — including an envelope from a different agent: only the
    // triage's recommendation is the triage's recommendation
    expect(actual).toEqual([undefined, undefined, undefined])
  },
)

test(
  [
    'given use-cases/advice::shellQuoted',
    'when the request is a sentence rather than a path',
    'it should survive being pasted into a shell',
  ].join(', '),
  () => {
    // given — a command that breaks on paste reads as the factory being
    // broken rather than as quoting being hard
    const awkward = 'fix the "retry" bug in $HOME, `now`'

    // when
    const actual = shellQuoted(awkward)

    // then
    expect(actual).toEqual('"fix the \\"retry\\" bug in \\$HOME, \\`now\\`"')
  },
)
