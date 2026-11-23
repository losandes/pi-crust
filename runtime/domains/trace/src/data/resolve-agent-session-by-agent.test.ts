import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentConfigSchema } from '../../../../lib/contracts'
import { resolveAgentSessionByAgent } from './resolve-agent-session-by-agent'
import { createTracer } from './trace-db'

const scratch = (): string =>
  mkdtempSync(join(tmpdir(), 'crust-agent-session-'))

for (const { name, agent, sessionId, expected } of [
  {
    name: 'a matching row',
    agent: 'planner',
    sessionId: 'session-1',
    expected: { sessionId: 'session-1' },
  },
  {
    name: 'another agent only',
    agent: 'builder',
    sessionId: 'session-1',
    expected: undefined,
  },
  {
    name: 'an empty session id',
    agent: 'planner',
    sessionId: '',
    expected: undefined,
  },
]) {
  test(
    [
      `given resolveAgentSessionByAgent and ${name}`,
      'when looking up the planner',
      'it should return only a non-empty matching session',
    ].join(', '),
    () => {
      // given
      const dir = scratch()
      try {
        const dbPath = join(dir, 'crust.db')
        const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
        tracer.sessionStart('r1', 'tester', 'sdlc')
        tracer.agentSessionRow(
          'r1',
          agentConfigSchema.parse({
            name: agent,
            prompts: '.',
            writes: [],
          }),
          sessionId,
          0,
          0,
        )
        tracer.close()

        // when
        const actual = resolveAgentSessionByAgent(dbPath)('r1', 'planner')

        // then
        expect(actual).toEqual(expected)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
}

test(
  [
    'given resolveAgentSessionByAgent and a missing database',
    'when looking up an agent',
    'it should return undefined without creating a database',
  ].join(', '),
  () => {
    // given
    const dir = scratch()
    try {
      const dbPath = join(dir, 'missing.db')

      // when
      const actual = resolveAgentSessionByAgent(dbPath)('r1', 'planner')

      // then
      expect(actual).toBeUndefined()
      expect(existsSync(dbPath)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)
