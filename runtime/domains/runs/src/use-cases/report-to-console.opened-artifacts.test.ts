import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TEventPayload } from '../../../../lib/contracts'
import {
  activityRunParams,
  ISSUE_OPENED_EVENT,
  PULL_REQUEST_EVENT,
} from '../../../../lib/contracts'
import { plain } from '../../../../lib/terminal'
import {
  restoreTerminal,
  silenceTerminal,
  terminalOutput,
} from '../../../../testing/terminal-capture'
import { createTracer } from '../../../trace'
import { createConsole } from './report-to-console'

const issue = 'https://github.com/acme/widgets/issues/42'
const pr = 'https://github.com/acme/widgets/pull/43'
const longUrl = 'https://example.com/'.padEnd(200, 'a')
const runId = 'aaaa1111'

type TCase = Readonly<{
  name: string
  issues: readonly TEventPayload[]
  pullRequests: readonly TEventPayload[]
  expected: readonly string[]
  resume?: boolean
  imported?: boolean
  ok: boolean
  tokens: number
  cost: number
}>

const cases: readonly TCase[] = [
  {
    name: 'C1 one issue',
    issues: [{ url: issue }],
    pullRequests: [],
    expected: [`  issue          ${issue}`],
    ok: true,
    tokens: 0,
    cost: 0,
  },
  {
    name: 'C2 a created pull request',
    issues: [],
    pullRequests: [{ url: pr, action: 'created' }],
    expected: [`  pull request   ${pr}`],
    ok: true,
    tokens: 0,
    cost: 0,
  },
  {
    name: 'C3 an updated pull request',
    issues: [],
    pullRequests: [{ url: pr, action: 'updated' }],
    expected: [`  pull request   ${pr}`],
    ok: true,
    tokens: 0,
    cost: 0,
  },
  {
    name: 'C4 a long URL',
    issues: [{ url: longUrl }],
    pullRequests: [],
    expected: [`  issue          ${longUrl}`],
    ok: true,
    tokens: 0,
    cost: 0,
  },
  {
    name: 'C5 both kinds',
    issues: [{ url: issue }],
    pullRequests: [{ url: pr }],
    expected: [`  issue          ${issue}`, `  pull request   ${pr}`],
    ok: true,
    tokens: 0,
    cost: 0,
  },
  {
    name: 'C6 a resumed pull request',
    issues: [],
    pullRequests: [{ url: pr, action: 'created' }],
    expected: [`  pull request   ${pr}`],
    resume: true,
    ok: true,
    tokens: 0,
    cost: 0,
  },
  {
    name: 'C7 only an import and refusal',
    issues: [],
    pullRequests: [],
    expected: [],
    imported: true,
    ok: true,
    tokens: 0,
    cost: 0,
  },
  {
    name: 'C8 a failed run',
    issues: [{ url: issue }],
    pullRequests: [],
    expected: [`  issue          ${issue}`],
    ok: false,
    tokens: 0,
    cost: 0,
  },
  {
    name: 'C9 a resumed issue',
    issues: [{ url: issue }],
    pullRequests: [],
    expected: [`  issue          ${issue}`],
    resume: true,
    ok: true,
    tokens: 0,
    cost: 0,
  },
  {
    name: 'C10 usage and an issue',
    issues: [{ url: issue }],
    pullRequests: [],
    expected: [`  issue          ${issue}`],
    ok: true,
    tokens: 1234,
    cost: 0.1234,
  },
]

for (const scenario of cases) {
  test(
    [
      `given ${scenario.name}`,
      'when the real console finishes the run',
      'it should print and trace complete artifact links directly after the unchanged panel',
    ].join(', '),
    () => {
      // given
      const dir = mkdtempSync(join(tmpdir(), 'crust-console-opened-'))
      const dbPath = join(dir, 'crust.db')
      const eventPath = join(dir, 'events.jsonl')
      const first = createTracer(dbPath, eventPath)
      first.sessionStart(runId, 'tester', 'compose')
      for (const payload of scenario.issues) {
        first.event({
          run_id: runId,
          type: 'log',
          name: ISSUE_OPENED_EVENT,
          payload,
        })
      }
      for (const payload of scenario.pullRequests) {
        first.event({
          run_id: runId,
          type: 'log',
          name: PULL_REQUEST_EVENT,
          payload,
        })
      }
      const activityRun = {
        activity_run_id: `${runId}_01_build`,
        run_id: runId,
        seq: 1,
        params: activityRunParams({
          name: 'build',
          kind: 'agent',
          owner: 'builder',
          description: 'Build the fixture work',
        }),
        status: 'success' as const,
        error: undefined,
        started_at: undefined,
        ended_at: undefined,
      }
      first.activityRunUpsert(activityRun)
      if (scenario.imported) {
        first.event({
          run_id: runId,
          type: 'log',
          name: 'pull_request_refused',
          payload: { reason: 'refused' },
        })
        first.envelopeRow(
          activityRun,
          'import',
          'IdentifyOutput',
          JSON.stringify({
            issue_url: 'https://github.com/acme/widgets/issues/7',
          }),
          true,
        )
      }
      if (scenario.resume) first.close()
      const tracer = scenario.resume ? createTracer(dbPath, eventPath) : first
      if (scenario.resume && scenario.pullRequests.length > 0) {
        tracer.event({
          run_id: runId,
          type: 'log',
          name: PULL_REQUEST_EVENT,
          payload: { url: pr, action: 'updated' },
        })
      }
      silenceTerminal()
      try {
        // when
        createConsole(tracer, runId).sessionFinished(
          scenario.ok,
          scenario.tokens,
          scenario.cost,
          dbPath,
        )
        const lines = plain(terminalOutput()).trimEnd().split('\n')
        const bottom = lines.findIndex((line) => line.startsWith('╰'))
        // then
        expect(bottom).toBeGreaterThan(0)
        expect(lines.slice(bottom + 1)).toEqual([...scenario.expected])
        const traced = tracer
          .eventsNamed(runId, 'console')
          .map(({ message }) => message)
        for (const line of scenario.expected) {
          expect(traced).toContain(line)
          expect(lines.filter((printed) => printed === line)).toHaveLength(1)
          expect(line).not.toContain('…')
        }
        expect(lines.join('\n')).toContain(scenario.ok ? '✓ success' : '✗ fail')
        expect(lines.join('\n')).toContain('1/1 passed')
        expect(lines.join('\n')).toContain(
          scenario.tokens.toLocaleString('en-US'),
        )
        expect(lines.join('\n')).toContain(`$${scenario.cost.toFixed(4)}`)
        expect(lines.join('\n')).toContain(runId)
        expect(lines.join('\n')).toContain(dbPath)
        expect(lines.join('\n')).toContain(`crust activity-runs ${runId}`)
        if (scenario.imported)
          expect(lines.join('\n')).not.toContain('https://')
        if (scenario.name.startsWith('C4'))
          expect(lines.at(-1)).toHaveLength(217)
      } finally {
        restoreTerminal()
        tracer.close()
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
}
