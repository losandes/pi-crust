import { expect, test } from 'bun:test'
import { sessionDirFor } from './consult'
import {
  joinArgv,
  resolveJoin,
  type TJoinPorts,
  type TJoinRefusalReason,
} from './join-session'

const activityRuns: NonNullable<
  ReturnType<TJoinPorts['runState']>
>['activityRuns'] = [{ seq: 1, name: 'plan', kind: 'agent', owner: 'planner' }]

const ports: TJoinPorts = {
  runDirectory: (id) => `/data/sessions/${id}`,
  runState: () => ({ activityRuns }),
  hasLiveProcess: () => false,
  agentSession: () => ({ sessionId: 's1' }),
  sessionFile: () => '/history/s1.jsonl',
}

const refusalCases: readonly Readonly<{
  name: string
  overrides: Partial<TJoinPorts>
  reason: TJoinRefusalReason
  message: string
}>[] = [
  {
    name: 'an unknown run',
    overrides: { runState: () => undefined },
    reason: 'unknown-run',
    message: 'no run "r1" was found, so activity "plan" cannot be joined',
  },
  {
    name: 'a live run',
    overrides: { hasLiveProcess: () => true },
    reason: 'still-running',
    message:
      'run "r1" is still running; wait for it to finish or stop it before joining activity "plan"',
  },
  {
    name: 'an unknown activity',
    overrides: { runState: () => ({ activityRuns: [] }) },
    reason: 'unknown-activity',
    message: 'run "r1" has no activity "plan"',
  },
  {
    name: 'an engineer activity',
    overrides: {
      runState: () => ({
        activityRuns: [
          { seq: 1, name: 'plan', kind: 'engineer', owner: 'tester' },
        ],
      }),
    },
    reason: 'no-conversation',
    message:
      'activity "plan" in run "r1" has no conversation to join: it was not performed by an agent',
  },
  {
    name: 'an agent without a recorded conversation',
    overrides: { agentSession: () => undefined },
    reason: 'no-conversation',
    message:
      'activity "plan" in run "r1" has no conversation to join: agent "planner" recorded no pi session',
  },
  {
    name: 'missing history',
    overrides: { sessionFile: () => undefined },
    reason: 'history-missing',
    message: `the conversation of activity "plan" in run "r1" is no longer available: no pi session "s1" in ${sessionDirFor('/data/sessions/r1', 'planner')}`,
  },
  {
    name: 'a live run and an unknown activity',
    overrides: {
      hasLiveProcess: () => true,
      runState: () => ({ activityRuns: [] }),
    },
    reason: 'still-running',
    message:
      'run "r1" is still running; wait for it to finish or stop it before joining activity "plan"',
  },
  {
    name: 'an unknown run with a live process',
    overrides: { hasLiveProcess: () => true, runState: () => undefined },
    reason: 'unknown-run',
    message: 'no run "r1" was found, so activity "plan" cannot be joined',
  },
]

for (const { name, overrides, reason, message } of refusalCases) {
  test(
    [
      `given resolveJoin and ${name}`,
      'when resolving the conversation',
      'it should return the first refusal with its full reason',
    ].join(', '),
    () => {
      // given
      const deps = { ...ports, ...overrides }

      // when
      const actual = resolveJoin(deps)({ runId: 'r1', activity: 'plan' })

      // then
      expect(actual).toEqual({ status: 'error', error: { reason, message } })
    },
  )
}

test(
  [
    'given resolveJoin and two attempts of the same activity',
    'when the newer attempt has another owner',
    'it should resolve the newest owner regardless of input order',
  ].join(', '),
  () => {
    // given
    let agents: readonly string[] = []
    const deps: TJoinPorts = {
      ...ports,
      runState: () => ({
        activityRuns: [
          { seq: 5, name: 'plan', kind: 'agent', owner: 'new-planner' },
          ...activityRuns,
        ],
      }),
      agentSession: (_runId, agent) => {
        agents = [...agents, agent]
        return { sessionId: 's2' }
      },
    }

    // when
    const actual = resolveJoin(deps)({ runId: 'r1', activity: 'plan' })

    // then
    expect(agents).toEqual(['new-planner'])
    expect(actual).toEqual({
      status: 'ok',
      data: {
        agent: 'new-planner',
        sessionId: 's2',
        sessionFile: '/history/s1.jsonl',
      },
    })
  },
)

test(
  [
    'given resolveJoin and an available conversation',
    'when resolving the activity',
    'it should look in the agent directory and return the whole target',
  ].join(', '),
  () => {
    // given
    let calls: readonly (readonly string[])[] = []
    const deps: TJoinPorts = {
      ...ports,
      sessionFile: (dir, id) => {
        calls = [...calls, [dir, id]]
        return '/history/s1.jsonl'
      },
    }

    // when
    const actual = resolveJoin(deps)({ runId: 'r1', activity: 'plan' })

    // then
    expect(calls).toEqual([
      [sessionDirFor('/data/sessions/r1', 'planner'), 's1'],
    ])
    expect(actual).toEqual({
      status: 'ok',
      data: {
        agent: 'planner',
        sessionId: 's1',
        sessionFile: '/history/s1.jsonl',
      },
    })
  },
)

test(
  [
    'given joinArgv and a session file',
    'when composing the interactive command',
    'it should pass only the binary and session path',
  ].join(', '),
  () => {
    // given
    const file = '/a/b.jsonl'

    // when
    const actual = joinArgv('pi', file)

    // then
    expect(actual).toEqual(['pi', '--session', file])
  },
)
