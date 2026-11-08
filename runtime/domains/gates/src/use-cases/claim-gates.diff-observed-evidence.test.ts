import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TEnvelopeBase, TRun } from '../../../../lib/contracts'
import { violationsOf } from '../../../../lib/contracts'
import { diffMatchesClaims } from './claim-gates'

/*
 * Independent coverage for
 * https://github.com/losandes/pi-crust/issues/3: `diff_matches_claims`
 * must settle a claim by existence OR by the run's own `changedPaths`
 * observation, not by `existsSync` alone, and the report must say which
 * kind of evidence settled it.
 *
 * These fixtures are deliberately separate from the pre-existing
 * `claim-gates.test.ts` file rather than extending it, so the two exert
 * independent pressure on the same gate.
 */

const traced = (): TRun =>
  ({
    runId: 'bbbb2222',
    activityRuns: () => [],
    tracer: { event: () => '' },
  }) as unknown as TRun

const runWithRepoRoot = (repoRoot: string): TRun =>
  ({ ...traced(), repoRoot, vcsRoot: repoRoot }) as unknown as TRun

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
    'given use-cases/gates::diffMatchesClaims (1.4.1)',
    'when a claimed file was deleted during the run and the run observed that path as changed',
    'it should settle the claim as satisfied rather than failing on existsSync alone',
  ].join(', '),
  () => {
    // given — a repo root that no longer has the claimed file, because this
    // run deleted it
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-diff-evidence-deleted-'))
    const claimedPath = 'cron/stats-cron'
    const run = runWithRepoRoot(repoRoot)
    const envelope = envelopeClaiming([claimedPath])

    // when — the run's own observation names the same path as changed
    const report = diffMatchesClaims.check(envelope, run, [claimedPath])

    // then — no violation, and the note distinguishes this from a bad claim
    expect(violationsOf(report)).toHaveLength(0)
    expect(report.checks[0]?.ok).toBe(true)
    expect(report.checks[0]?.note).not.toBe('')
  },
)

test(
  [
    'given use-cases/gates::diffMatchesClaims (1.4.2)',
    'when an Activity reports a move as two claims -- the source path and the destination path',
    'it should settle both, the destination because it exists and the source because it was observed',
  ].join(', '),
  () => {
    // given — the destination of a move exists on disk; the source does not,
    // because moving it is what deleted it
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-diff-evidence-move-'))
    mkdirSync(join(repoRoot, 'spotify-gateway-cron'), { recursive: true })
    writeFileSync(
      join(repoRoot, 'spotify-gateway-cron', 'stats-cron'),
      'content\n',
    )
    const sourcePath = 'spotify-gateway/stats-cron'
    const destPath = 'spotify-gateway-cron/stats-cron'
    const run = runWithRepoRoot(repoRoot)
    const envelope = envelopeClaiming([sourcePath, destPath])

    // when — the run observed both halves of the move
    const report = diffMatchesClaims.check(envelope, run, [
      sourcePath,
      destPath,
    ])

    // then — an Activity is not forced to omit the source path to pass the
    // gate (1.3.3): both claims are satisfied
    expect(report.checks).toHaveLength(2)
    expect(violationsOf(report)).toHaveLength(0)
  },
)

test(
  [
    'given use-cases/gates::diffMatchesClaims (1.4.3)',
    'when a claimed path neither exists on disk nor appears in the observed set',
    'it should still fail the gate, naming the claimed path as a violation',
  ].join(', '),
  () => {
    // given — a claim for a path this run neither wrote nor deleted
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-diff-evidence-bad-'))
    const claimedPath = 'invented/path.txt'
    const run = runWithRepoRoot(repoRoot)
    const envelope = envelopeClaiming([claimedPath])

    // when — the observed set is empty, so neither kind of evidence applies
    const report = diffMatchesClaims.check(envelope, run, [])

    // then — exactly one violation, naming the claimed path
    const violations = violationsOf(report)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain(claimedPath)
  },
)

test(
  [
    'given use-cases/gates::diffMatchesClaims (1.4.4)',
    'when a claimed path exists on disk and was also not reported as changed by the run',
    'it should settle the claim by existence, so the gate does not widen into accepting any claim',
  ].join(', '),
  () => {
    // given — a file that is simply there, with an empty observed set
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-diff-evidence-exists-'))
    writeFileSync(join(repoRoot, 'present.txt'), 'content\n')
    const run = runWithRepoRoot(repoRoot)
    const envelope = envelopeClaiming(['present.txt'])

    // when — existence alone is the only evidence available
    const report = diffMatchesClaims.check(envelope, run, [])

    // then — satisfied, proving existence still works on its own
    expect(violationsOf(report)).toHaveLength(0)
    expect(report.checks[0]?.ok).toBe(true)
  },
)

test(
  [
    'given use-cases/gates::diffMatchesClaims (1.2.3)',
    'when one claim is satisfied by existence, one by observation, and one by neither',
    'it should produce three checks whose notes let a reader tell them apart without opening the diff',
  ].join(', '),
  () => {
    // given — three claims, one of each kind
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-diff-evidence-mixed-'))
    writeFileSync(join(repoRoot, 'kept.txt'), 'content\n')
    const existsPath = 'kept.txt'
    const deletedPath = 'removed.txt'
    const invalidPath = 'never-touched.txt'
    const run = runWithRepoRoot(repoRoot)
    const envelope = envelopeClaiming([existsPath, deletedPath, invalidPath])

    // when — only the deleted path was observed as changed
    const report = diffMatchesClaims.check(envelope, run, [deletedPath])

    // then — exactly one violation (the untouched path), and the two
    // satisfied notes are distinguishable from each other
    const violations = violationsOf(report)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain(invalidPath)

    const existsCheck = report.checks.find((check) => check.item === existsPath)
    const deletedCheck = report.checks.find(
      (check) => check.item === deletedPath,
    )
    expect(existsCheck?.ok).toBe(true)
    expect(deletedCheck?.ok).toBe(true)
    expect(existsCheck?.note).not.toBe(deletedCheck?.note)
  },
)

test(
  [
    'given use-cases/gates::diffMatchesClaims (resolve)',
    'when a claimed path exists at the VCS root but not inside the narrower workspace root',
    'it should still settle the claim and emit the outside-workspace warning event',
  ].join(', '),
  () => {
    // given — a monorepo workspace nested under a VCS root, with the claimed
    // file only present above the workspace
    const vcsRoot = mkdtempSync(join(tmpdir(), 'crust-diff-evidence-vcs-'))
    const repoRoot = join(vcsRoot, 'packages', 'gateway')
    mkdirSync(repoRoot, { recursive: true })
    const claimedPath = 'shared/lockfile.txt'
    mkdirSync(join(vcsRoot, 'shared'), { recursive: true })
    writeFileSync(join(vcsRoot, 'shared', 'lockfile.txt'), 'content\n')
    const events: unknown[] = []
    const run = {
      ...traced(),
      repoRoot,
      vcsRoot,
      tracer: {
        // biome-ignore lint/plugin/no-array-mutation: recording what was filed is the test
        event: (payload: unknown) => events.push(payload),
      },
    } as unknown as TRun
    const envelope = envelopeClaiming([claimedPath])

    // when
    const report = diffMatchesClaims.check(envelope, run, [])

    // then — settled by existence at the wider root, and the warning fired
    expect(violationsOf(report)).toHaveLength(0)
    expect(events).toHaveLength(1)
  },
)

test(
  [
    'given use-cases/gates::diffMatchesClaims (1.1.4)',
    'when the changedPaths argument passed to check is simply ignored by the implementation',
    'it should fail a deleted-but-observed claim, proving the third argument is actually consulted',
  ].join(', '),
  () => {
    /*
     * This targets the regression the issue names directly: an
     * implementation that stats the claim and nothing else. If
     * `changedPaths` is ignored, this deleted claim has no evidence behind
     * it and the gate reports a violation -- the pre-fix behaviour this
     * issue exists to change.
     */
    // given — a claimed path deleted by the run, reported in changedPaths
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-diff-evidence-wired-'))
    const claimedPath = 'gone/file.txt'
    const run = runWithRepoRoot(repoRoot)
    const envelope = envelopeClaiming([claimedPath])

    // when
    const report = diffMatchesClaims.check(envelope, run, [claimedPath])

    // then — the gate must use the observed set, or this assertion fails
    expect(violationsOf(report)).toHaveLength(0)
  },
)
