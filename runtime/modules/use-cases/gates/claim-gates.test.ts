import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TEnvelopeBase } from '../../typedefs/envelope'
import { violationsOf } from '../../typedefs/gate'
import type { TRun } from '../../typedefs/run'
import {
  artifactsExist,
  diffMatchesClaims,
  filesNonEmpty,
  jsonParses,
} from './claim-gates'

const runWithRepoRoot = (repoRoot: string): TRun =>
  ({
    repoRoot,
    activityRuns: () => [],
  }) as unknown as TRun

const envelopeClaiming = (changed: readonly string[]): TEnvelopeBase =>
  ({
    status: 'success',
    summary: 'built it',
    artifacts: [],
    notes_for_next_agent: '',
    changed_files: changed,
  }) as unknown as TEnvelopeBase

const envelopeWithArtifacts = (artifacts: readonly string[]): TEnvelopeBase =>
  ({
    status: 'success',
    summary: 'built it',
    artifacts,
    notes_for_next_agent: '',
    changed_files: [],
  }) as unknown as TEnvelopeBase

const runWithoutRepoRoot = (): TRun =>
  ({
    activityRuns: () => [],
  }) as unknown as TRun

test(
  [
    'given use-cases/gates::diffMatchesClaims',
    'when the orchestrator is invoked from a subdirectory of run.repoRoot',
    'it should resolve a claimed path against run.repoRoot rather than process.cwd()',
  ].join(', '),
  () => {
    /*
     * given — a repo root containing the claimed file, and an orchestrator
     * process whose cwd is a SUBDIRECTORY of that root (the monorepo case in
     * specs/todos/FIX-RELATIVE-DIFF-CHECKS.md: the run was kicked off from
     * `_newstack`, one level below the root that actually contains the
     * changed file).
     */
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-diff-claims-'))
    mkdirSync(join(repoRoot, '.prodcontainer', 'spotify-gateway'), {
      recursive: true,
    })
    writeFileSync(
      join(repoRoot, '.prodcontainer', 'spotify-gateway', 'Dockerfile'),
      'FROM scratch\n',
    )

    const subdir = join(repoRoot, '_newstack')
    mkdirSync(subdir, { recursive: true })
    const was = process.cwd()
    process.chdir(subdir)

    try {
      const run = runWithRepoRoot(repoRoot)
      const envelope = envelopeClaiming([
        '.prodcontainer/spotify-gateway/Dockerfile',
      ])

      // when
      const report = diffMatchesClaims.check(envelope, run, [
        '.prodcontainer/spotify-gateway/Dockerfile',
      ])

      // then — the file exists at repoRoot, so the gate must pass
      const violations = violationsOf(report)
      expect(violations).toHaveLength(0)
    } finally {
      process.chdir(was)
    }
  },
)

test(
  [
    'given use-cases/gates::artifactsExist',
    'when the claimed artifact is relative to run.repoRoot but absent under process.cwd()',
    'it should resolve the claim against run.repoRoot',
  ].join(', '),
  () => {
    // given
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-artifacts-exist-'))
    mkdirSync(join(repoRoot, 'out'), { recursive: true })
    writeFileSync(join(repoRoot, 'out', 'result.txt'), 'done\n')

    const subdir = join(repoRoot, '_newstack')
    mkdirSync(subdir, { recursive: true })
    const was = process.cwd()
    process.chdir(subdir)

    try {
      const run = runWithRepoRoot(repoRoot)
      const envelope = envelopeWithArtifacts(['out/result.txt'])

      // when
      const report = artifactsExist.check(envelope, run, [])

      // then — the claim was actually checked, not silently skipped
      expect(report.checks).toHaveLength(1)
      expect(violationsOf(report)).toHaveLength(0)
    } finally {
      process.chdir(was)
    }
  },
)

test(
  [
    'given use-cases/gates::filesNonEmpty',
    'when the claimed artifact is relative to run.repoRoot but absent under process.cwd()',
    'it should resolve the claim against run.repoRoot',
  ].join(', '),
  () => {
    // given
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-files-non-empty-'))
    mkdirSync(join(repoRoot, 'out'), { recursive: true })
    writeFileSync(join(repoRoot, 'out', 'result.txt'), 'done\n')

    const subdir = join(repoRoot, '_newstack')
    mkdirSync(subdir, { recursive: true })
    const was = process.cwd()
    process.chdir(subdir)

    try {
      const run = runWithRepoRoot(repoRoot)
      const envelope = envelopeWithArtifacts(['out/result.txt'])

      // when
      const report = filesNonEmpty.check(envelope, run, [])

      // then — the claim was actually checked, not silently skipped
      // (filesNonEmpty skips any path that isn't `isFile`, so a report with
      // zero checks would mean the resolution against repoRoot never happened
      // rather than that it passed)
      expect(report.checks).toHaveLength(1)
      expect(violationsOf(report)).toHaveLength(0)
    } finally {
      process.chdir(was)
    }
  },
)

test(
  [
    'given use-cases/gates::jsonParses',
    'when the claimed artifact is relative to run.repoRoot but absent under process.cwd()',
    'it should resolve the claim against run.repoRoot',
  ].join(', '),
  () => {
    // given
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-json-parses-'))
    mkdirSync(join(repoRoot, 'out'), { recursive: true })
    writeFileSync(join(repoRoot, 'out', 'result.json'), '{"ok":true}')

    const subdir = join(repoRoot, '_newstack')
    mkdirSync(subdir, { recursive: true })
    const was = process.cwd()
    process.chdir(subdir)

    try {
      const run = runWithRepoRoot(repoRoot)
      const envelope = envelopeWithArtifacts(['out/result.json'])

      // when
      const report = jsonParses.check(envelope, run, [])

      // then — the claim was actually checked, not silently skipped
      // (jsonParses skips any path for which `fileExists` is false, so a
      // report with zero checks would mean the resolution against repoRoot
      // never happened rather than that it passed)
      expect(report.checks).toHaveLength(1)
      expect(violationsOf(report)).toHaveLength(0)
    } finally {
      process.chdir(was)
    }
  },
)

test(
  [
    'given use-cases/gates::diffMatchesClaims',
    'when a relative claim exists under neither run.repoRoot nor process.cwd()',
    'it should still fail, reporting the claimed spelling',
  ].join(', '),
  () => {
    // given — a repo root that does NOT contain the claimed file
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-diff-claims-wrong-'))
    const claimedPath = 'out/does-not-exist.txt'

    const run = runWithRepoRoot(repoRoot)
    const envelope = envelopeClaiming([claimedPath])

    // when
    const report = diffMatchesClaims.check(envelope, run, [claimedPath])

    // then — exactly one violation, naming the claimed spelling
    const violations = violationsOf(report)
    expect(violations).toHaveLength(1)
    expect(report.checks).toHaveLength(1)
    expect(report.checks[0]?.item).toBe(claimedPath)
    expect(report.checks[0]?.ok).toBe(false)
  },
)

test(
  [
    'given use-cases/gates::diffMatchesClaims',
    'when the claim is an absolute path outside run.repoRoot',
    'it should honour the absolute path as written',
  ].join(', '),
  () => {
    // given — a file OUTSIDE repoRoot, claimed by its absolute path
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-diff-claims-root-'))
    const outside = mkdtempSync(join(tmpdir(), 'crust-diff-claims-outside-'))
    const absolutePath = join(outside, 'elsewhere.txt')
    writeFileSync(absolutePath, 'content\n')

    const run = runWithRepoRoot(repoRoot)
    const envelope = envelopeClaiming([absolutePath])

    // when
    const report = diffMatchesClaims.check(envelope, run, [absolutePath])

    // then
    expect(violationsOf(report)).toHaveLength(0)
  },
)

test(
  [
    'given use-cases/gates::diffMatchesClaims',
    'when run.repoRoot is absent',
    'it should fall back to resolving the claim against process.cwd()',
  ].join(', '),
  () => {
    // given — a TRun with no repoRoot, and a file under a chdir'd cwd
    const cwdDir = mkdtempSync(join(tmpdir(), 'crust-diff-claims-fallback-'))
    writeFileSync(join(cwdDir, 'fallback.txt'), 'content\n')

    const was = process.cwd()
    process.chdir(cwdDir)

    try {
      const run = runWithoutRepoRoot()
      const envelope = envelopeClaiming(['fallback.txt'])

      // when
      const report = diffMatchesClaims.check(envelope, run, ['fallback.txt'])

      // then — no throw, and the relative claim resolves against cwd
      expect(violationsOf(report)).toHaveLength(0)
    } finally {
      process.chdir(was)
    }
  },
)
