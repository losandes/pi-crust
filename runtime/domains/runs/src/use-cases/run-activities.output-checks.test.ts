import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TActivityContext,
  TPiCrustConfig,
  TRun,
} from '../../../../lib/contracts'
import {
  crustConfigSchema,
  DEFAULT_ACTIVITY_OPTIONS,
} from '../../../../lib/contracts'
import { runWithTracer } from '../../../../testing/fake-activity'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import { runnableActivities, type TAgentPorts } from '../../../activities'
import { emptyUsage, type TPiRequest } from '../../../agents'
import { readRunState } from '../../../trace'
import { runActivities } from './run-activities'

for (const missing of [false, true]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given a resolved Activity declaring an ${missing ? 'initially missing' : 'existing'} artifact without configured checks`,
      'when running and judging its reports',
      'it should record the artifact verdict and spend one attempt on a missing claim',
    ].join(', '),
    async () => {
      // given
      const dir = mkdtempSync(join(tmpdir(), 'crust-output-check-wiring-'))
      const cfg: TPiCrustConfig = crustConfigSchema.parse({
        defaults: { data_dir: join(dir, 'data'), protected_files: [] },
        observability: {},
        activities: [
          {
            name: 'research',
            purpose: 'Write the research evidence and report its artifact',
            output: 'genericOutput',
            writes: ['*'],
            prompts: '.',
          },
        ],
        agents: [
          {
            name: 'research',
            writes: ['*'],
            prompts: '.',
          },
        ],
      })
      const base = runWithTracer(dir, cfg)
      const run: TRun = { ...base, repoRoot: dir, vcsRoot: dir }
      run.tracer.sessionStart(run.runId, 'tester', 'compose')
      const artifact = join(dir, 'evidence.md')
      if (!missing) writeFileSync(artifact, 'evidence\n')
      let requests: readonly TPiRequest[] = []
      const ports: TAgentPorts = {
        run: (request) => {
          requests = [...requests, request]
          if (requests.length === 2)
            writeFileSync(artifact, 'corrected evidence\n')
          return Promise.resolve({
            text: JSON.stringify({ status: 'success', artifacts: [artifact] }),
            returncode: 0,
            sessionId: request.sessionId,
            tokens: 0,
            cost: 0,
            usage: emptyUsage,
            contextTokens: 0,
            contextWindow: 0,
          })
        },
        changed: () => [],
        untracked: () => [],
        render: (path) => path,
        savePrompt: (directory, name) => join(directory, name),
        snapshot: () => ({}),
        rev: () => '',
        head: () => '',
        history: () => () => [],
        content: () => ({ status: 'ok', data: {} }),
      }
      const activity = runnableActivities(
        ['research'],
        cfg,
        DEFAULT_ACTIVITY_OPTIONS,
        ports,
      )[0]
      if (activity === undefined) throw new Error('missing research fixture')
      const start: TActivityContext = {
        run,
        prompt: 'research',
        previous: undefined,
        previousStep: undefined,
        upstream: [],
        cohort: [],
        baseline: '',
        outcomes: [],
        feedback: [],
      }
      silenceTerminal()
      try {
        // when
        const actual = await runActivities({
          run,
          activities: [activity],
          start,
        })
        // then
        expect(actual.outcomes).toEqual([
          { activity: 'research', accepted: true },
        ])
        expect(requests).toHaveLength(missing ? 2 : 1)
        const rows =
          readRunState(run.tracer.dbPath, run.runId)?.activityRuns ?? []
        expect(rows).toHaveLength(missing ? 2 : 1)
        expect(
          rows.at(-1)?.gates.find((gate) => gate.gate === 'artifacts_exist')
            ?.checks,
        ).toContainEqual(expect.objectContaining({ item: artifact, ok: true }))
        if (missing) {
          expect(
            rows[0]?.gates.find((gate) => gate.gate === 'artifacts_exist')
              ?.passed,
          ).toBe(false)
          expect(requests[1]?.prompt).toContain(
            `${artifact}: declared artifact does not exist`,
          )
          expect(rows[1]?.seq).toBe((rows[0]?.seq ?? 0) + 1)
        }
      } finally {
        run.tracer.close()
        restoreTerminal()
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
}
