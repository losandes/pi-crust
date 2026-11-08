import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TActivity,
  TActivityRun,
  TBuildOutput,
  TRun,
} from '../../../../lib/contracts'
import { activityRunParams } from '../../../../lib/contracts'
import { diffMatchesClaims } from '../../../gates'
import { observedPayload, PATHS_TOUCHED } from '../../../policy'
import { judgeGates } from './run-activities'

/*
 * Independent, additional coverage for
 * https://github.com/losandes/pi-crust/issues/3's production wiring, beyond
 * what `run-activities.test.ts` (written by the build stage) already
 * covers. That file's own "nothing ever touched" case happens to pass
 * against both the fixed and the pre-fix `judgeGates`, because its mock
 * envelope does not conform to `buildOutputSchema` and so
 * `narrowEnvelope(buildOutput, envelope)` -- the function the pre-fix
 * `claimedPaths` helper used -- returns `undefined` either way, making the
 * self-referential bug a no-op for that particular fixture. (Verified by
 * temporarily restoring the pre-fix `judgeGates` body: its own first test
 * still passed; only its second test failed.) The first test below closes
 * that gap with a fixture that DOES conform to the schema the pre-fix code
 * actually read, so it would have passed unconditionally under the bug this
 * issue describes. The second test covers 1.3.1/1.3.2's "every attempt"
 * requirement, which neither file exercises today.
 */

const activityRunRow = (name: string, activityRunId: string): TActivityRun => ({
  activity_run_id: activityRunId,
  run_id: 'dddd4444',
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

const runWithTrace = (
  repoRoot: string,
  runs: readonly TActivityRun[],
  payloads: readonly Readonly<Record<string, unknown>>[],
): TRun =>
  ({
    runId: 'dddd4444',
    repoRoot,
    vcsRoot: repoRoot,
    activityRuns: () => runs,
    tracer: {
      eventsNamed: (_runId: string, name: string) =>
        name === PATHS_TOUCHED ? payloads : [],
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

/** A full, schema-conformant `BuildOutput` -- what a real Activity sends. */
const realBuildEnvelope = (changedFiles: readonly string[]): TBuildOutput => ({
  status: 'success',
  summary: 'built it',
  artifacts: [],
  notes_for_next_agent: '',
  facts: [],
  decisions: [],
  assumptions: [],
  unresolved: [],
  risks: [],
  objective_met: { met: true, evidence: 'it built' },
  regress_to: { activity: '', because: '' },
  changed_files: [...changedFiles],
  commit_message: 'build it',
  disputes: [],
})

test(
  [
    'given use-cases/run-activities::judgeGates',
    'when a schema-conformant BuildOutput claims a path nothing ever touched',
    'it should fail diff_matches_claims, even though claimedPaths(envelope) would have read the identical path back out of that same conformant envelope',
  ].join(', '),
  () => {
    // given — a real (schema-valid) envelope claiming a path, and a trace
    // saying this Activity Run touched something else entirely
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-judge-gates-real-'))
    const run = runWithTrace(
      repoRoot,
      [activityRunRow('build', 'id_build')],
      [
        observedPayload({
          activity: 'build',
          activityRunId: 'id_build',
          agent: 'builder',
          touched: ['real/file-this-run-actually-wrote.ts'],
          dirtyBefore: [],
          claimed: [],
        }),
      ],
    )
    const envelope = realBuildEnvelope(['totally/invented/path.txt'])

    // when
    const violations = judgeGates(run, activityNamed('build'), envelope)

    // then — the claim is neither on disk nor observed, so it fails; under
    // the pre-fix wiring, feeding `diffMatchesClaims` this envelope's own
    // `changed_files` back as "observed" would have made this claim settle
    // against itself and pass
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('totally/invented/path.txt')
  },
)

test(
  [
    'given use-cases/run-activities::judgeGates (1.3.1/1.3.2, "every attempt")',
    'when an Activity was re-run after an earlier attempt and the file in question was touched only by the earlier attempt',
    'it should still settle the claim as satisfied, because touchedBy aggregates every attempt of the instance',
  ].join(', '),
  () => {
    /*
     * given — two Activity Runs for the same instance ("build"), simulating
     * a gate re-run: the first attempt touched one file and failed for an
     * unrelated reason, the second attempt touched a different file. The
     * final envelope (from the second attempt) claims BOTH paths, which is
     * an honest record of what the instance did across both tries.
     */
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-judge-gates-retry-'))
    const firstAttemptPath = 'from-first-attempt.txt'
    const secondAttemptPath = 'from-second-attempt.txt'
    const run = runWithTrace(
      repoRoot,
      [
        activityRunRow('build', 'id_build_1'),
        activityRunRow('build', 'id_build_2'),
      ],
      [
        observedPayload({
          activity: 'build',
          activityRunId: 'id_build_1',
          agent: 'builder',
          touched: [firstAttemptPath],
          dirtyBefore: [],
          claimed: [],
        }),
        observedPayload({
          activity: 'build',
          activityRunId: 'id_build_2',
          agent: 'builder',
          touched: [secondAttemptPath],
          dirtyBefore: [],
          claimed: [],
        }),
      ],
    )
    const envelope = realBuildEnvelope([firstAttemptPath, secondAttemptPath])

    // when
    const violations = judgeGates(run, activityNamed('build'), envelope)

    // then — both claims satisfied by observation, neither dropped for
    // belonging to an earlier attempt
    expect(violations).toHaveLength(0)
  },
)
