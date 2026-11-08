import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TActivity,
  TActivityRun,
  TEnvelopeBase,
  TRun,
} from '../../../../lib/contracts'
import { activityRunParams } from '../../../../lib/contracts'
import { diffMatchesClaims } from '../../../gates'
import { observedPayload, PATHS_TOUCHED } from '../../../policy'
import { judgeGates } from './run-activities'

/*
 * https://github.com/losandes/pi-crust/issues/3, end to end: the gate's
 * logic is correct in isolation (claim-gates.test.ts), but its only
 * production caller is `judgeGates`, which decides what `gate.check`'s
 * third argument actually is. These tests exercise `judgeGates` itself,
 * not `diffMatchesClaims.check` called directly, so a regression that
 * re-wires `judgeGates` to feed a gate the envelope's own claim as
 * "observed" evidence — making every claim unconditionally pass — fails
 * here even though the gate's own unit tests would stay green.
 */

const activityRunRow = (name: string): TActivityRun => ({
  activity_run_id: `id_${name}`,
  run_id: 'cccc3333',
  seq: 1,
  params: activityRunParams({
    name,
    kind: 'agent',
    owner: 'builder',
    description: 'exercise judgeGates end to end',
  }),
  status: 'running',
  error: undefined,
  started_at: undefined,
  ended_at: undefined,
})

const runWith = (repoRoot: string, touched: readonly string[]): TRun =>
  ({
    runId: 'cccc3333',
    repoRoot,
    vcsRoot: repoRoot,
    activityRuns: () => [activityRunRow('build')],
    tracer: {
      eventsNamed: (_runId: string, name: string) =>
        name === PATHS_TOUCHED && touched.length > 0
          ? [
              observedPayload({
                activity: 'build',
                activityRunId: 'id_build',
                agent: 'builder',
                touched,
                dirtyBefore: [],
                claimed: [],
              }),
            ]
          : [],
      gateRow: () => undefined,
      event: () => '',
    },
    console: { gateResult: () => undefined },
  }) as unknown as TRun

const activityNamed = (instance: string): TActivity =>
  ({
    name: 'build',
    instance,
    gates: [diffMatchesClaims],
  }) as unknown as TActivity

const envelopeClaiming = (changed: readonly string[]): TEnvelopeBase =>
  ({
    status: 'success',
    summary: 'built it',
    artifacts: [],
    notes_for_next_agent: '',
    changed_files: changed,
  }) as unknown as TEnvelopeBase

test(
  [
    'given use-cases/run-activities::judgeGates',
    'when an Activity claims a path nothing ever touched',
    "it should fail diff_matches_claims, proving the gate's changedPaths argument is a real observation, not the envelope's own claim fed back to it",
  ].join(', '),
  () => {
    // given — a repo root that does not contain the invented path, and a
    // trace recording that this Activity Run touched something else entirely
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-judge-gates-'))
    const run = runWith(repoRoot, ['real/file-this-run-actually-wrote.ts'])
    const envelope = envelopeClaiming(['totally/invented/path.txt'])

    // when
    const violations = judgeGates(run, activityNamed('build'), envelope)

    // then — the claim is neither on disk nor observed, so it fails
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('totally/invented/path.txt')
  },
)

test(
  [
    'given use-cases/run-activities::judgeGates',
    'when an Activity reports a path this run actually observed as changed (the destination half of a move, or a deletion)',
    'it should settle diff_matches_claims as satisfied, using the trace-recorded observation rather than the claim',
  ].join(', '),
  () => {
    // given — the claimed path is gone from disk, but the trace this run
    // itself wrote (via enforcePermissions/paths_touched) says it changed
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-judge-gates-move-'))
    const claimed = 'old/moved-away.txt'
    const run = runWith(repoRoot, [claimed])
    const envelope = envelopeClaiming([claimed])

    // when
    const violations = judgeGates(run, activityNamed('build'), envelope)

    // then
    expect(violations).toHaveLength(0)
  },
)
