import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { contextEnvelopeSchema, EXIT } from '../../../../lib/contracts'
import { readLedger } from '../../../gates'
import { readRunState } from '../../../trace'
import { engineerName } from '../../../workspace'
import { answerPath } from './human-gate'
import {
  gateFixture,
  portsFor,
  QUESTION,
  review,
  work,
} from './human-gate-fixture.test'
import { runWorkflow } from './run-workflow'

for (const status of ['success', 'fail'] as const) {
  test(
    [
      `given #117 AC3/AC4: a reviser reporting ${status} with a question after a completed revise round`,
      'when the workflow is answered and resumed',
      'it should rerun the waiting reviser and re-ask its reviewer without replaying an earlier round',
    ].join(', '),
    async () => {
      // given
      using fixture = gateFixture({ attempts: 6 })
      const { run } = fixture
      const engineer = engineerName()
      let waitingId: string | undefined
      let statusAtRestart: string | undefined
      let roundsAtRestart: number | undefined
      const { ports, requests } = portsFor((model, attempt) => {
        if (model === 'fixture/build') {
          if (attempt === 3) {
            return work({ status, unresolved: [QUESTION] })
          }
          if (attempt > 3) {
            statusAtRestart = run.tracer
              .activityRunsFor(run.runId)
              .find((one) => one.activity_run_id === waitingId)?.status
            roundsAtRestart = readLedger(run).length
          }
          // a revise answers its review with a rewrite (`disputesSupported`)
          return work({ changed_files: ['src/retention.ts'] })
        }
        if (attempt === 1) return review()
        if (attempt === 2) {
          return review({
            blocking: ['Document how the retention window is authorised'],
            findings: [
              {
                requirement: 'Document how the retention window is authorised',
                met: false,
                evidence: 'src/retention.ts:24',
              },
            ],
          })
        }
        return review({ approved: true, blocking: [], findings: [] })
      })
      const args = {
        prompt: 'Implement the retention policy',
        config: fixture.configPath(),
        runId: run.runId,
        base: undefined,
        resume: false,
        activities: undefined,
        lifecycle: undefined,
        models: undefined,
        approveAfter: undefined,
        commit: 'false',
        stream: false,
        trustLevel: '50',
        handoff: undefined,
        name: undefined,
      }
      const execute = (resume: boolean) =>
        runWorkflow(
          { ...args, resume },
          [
            {
              name: 'deliver',
              strategy: 'serial',
              activities: ['build', 'review'],
            },
          ],
          ports,
          (pattern) => ({
            provider: 'fixture',
            modelId: pattern.slice('fixture/'.length),
          }),
          () => Promise.resolve(false),
        )
      expect(await execute(false)).toBe(EXIT.WAITING)
      expect(requests().map((one) => one.model)).toEqual([
        'fixture/build',
        'fixture/review',
        'fixture/build',
        'fixture/review',
        'fixture/build',
      ])
      const revisions = run.tracer
        .activityRunsFor(run.runId)
        .filter((one) => one.params.name === 'revise')
      expect(revisions.map((one) => one.status)).toEqual(['success', 'waiting'])
      waitingId = revisions.at(-1)?.activity_run_id
      const roundsBeforeAnswer = readLedger(run).length
      expect(roundsBeforeAnswer).toBe(2)
      expect(readRunState(run.tracer.dbPath, run.runId)?.status).toBe('waiting')
      const answer = 'The engineer authorises a retention window of 90 days.'
      writeFileSync(answerPath(run.contextHandoffDir), `${answer}\n`)

      // when
      const exit = await execute(true)

      // then
      expect(requests().map((one) => one.model)).toEqual([
        'fixture/build',
        'fixture/review',
        'fixture/build',
        'fixture/review',
        'fixture/build',
        'fixture/build',
        'fixture/review',
      ])
      expect(statusAtRestart).toBe('superseded')
      expect(roundsAtRestart).toBe(roundsBeforeAnswer)
      const restarted = requests()
        .filter((one) => one.model === 'fixture/build')
        .at(-1)
      // The rendered variables come first; the round's findings are appended
      // after them as the review findings block.
      const [rendered = '{}', feedback = ''] = (restarted?.prompt ?? '').split(
        '\n\n## Blocking findings from review',
      )
      expect(restarted?.prompt).not.toContain('## What failed last time')
      const variables = JSON.parse(rendered)
      const input = contextEnvelopeSchema.parse(
        JSON.parse(variables.previous_envelope ?? '{}'),
      )
      const state = readRunState(run.tracer.dbPath, run.runId)
      expect(input.facts).toContainEqual({
        fact: answer,
        evidence: `answered by ${engineer} in ${answerPath(run.contextHandoffDir)}`,
      })
      expect(feedback).toContain(
        '- Document how the retention window is authorised',
      )
      expect(
        run.tracer
          .activityRunsFor(run.runId)
          .filter((one) => one.params.name === 'revise')
          .map((one) => one.status),
      ).toEqual(['success', 'superseded', 'success'])
      expect(run.tracer.eventsNamed(run.runId, 'human_gate_open')).toEqual([
        expect.objectContaining({ kind: 'escalated' }),
      ])
      expect(exit).toBe(EXIT.SUCCESS)
      expect(state?.status).toBe('success')
    },
  )
}
