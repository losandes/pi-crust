import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TEnvelopeBase, TRun } from '../../../../lib/contracts'
import { violationsOf } from '../../../../lib/contracts'
import {
  artifactsExist,
  diffMatchesClaims,
  filesNonEmpty,
  jsonParses,
} from './claim-gates'

for (const { name, artifacts, content, gate } of [
  {
    name: 'missing artifact',
    artifacts: ['missing.md'],
    content: undefined,
    gate: artifactsExist,
  },
  {
    name: 'empty artifact',
    artifacts: ['empty.md'],
    content: '',
    gate: filesNonEmpty,
  },
  {
    name: 'invalid JSON artifact',
    artifacts: ['broken.json'],
    content: '{broken',
    gate: jsonParses,
  },
]) {
  test(
    [
      `given a report with a ${name}`,
      'when judging its artifact check',
      'it should reject the claim and name the artifact',
    ].join(', '),
    () => {
      // given
      const dir = mkdtempSync(join(tmpdir(), 'crust-artifact-failure-'))
      if (content !== undefined)
        writeFileSync(join(dir, artifacts[0] ?? ''), content)
      try {
        // when
        const actual = gate.check(
          envelopeWithArtifacts(artifacts),
          runWithRepoRoot(dir),
          [],
        )
        // then
        expect(violationsOf(actual)).toHaveLength(1)
        expect(actual.checks[0]).toMatchObject({
          item: artifacts[0],
          ok: false,
        })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
}

for (const gate of [artifactsExist, filesNonEmpty, jsonParses]) {
  test(
    [
      `given no artifacts for ${gate.name}`,
      'when judging the report',
      'it should pass without inventing any item',
    ].join(', '),
    () => {
      // given
      const envelope = envelopeWithArtifacts([])
      // when
      const actual = gate.check(envelope, runWithRepoRoot('/unused'), [])
      // then
      expect(actual.checks).toEqual([])
      expect(violationsOf(actual)).toEqual([])
    },
  )
}

const traced = (): {
  run: TRun
  events: Readonly<Record<string, unknown>>[]
} => {
  const events: Record<string, unknown>[] = []
  const run = {
    runId: 'aaaa1111',
    activityRuns: () => [],
    tracer: {
      event: (input: Readonly<Record<string, unknown>>) => {
        // biome-ignore lint/plugin/no-array-mutation: recording what was filed is the test
        events.push(input)
        return ''
      },
    },
  } as unknown as TRun

  return { run, events }
}

const runWithRoots = (workspaceRoot: string, vcsRoot: string): TRun => {
  const { run } = traced()
  return { ...run, repoRoot: workspaceRoot, vcsRoot } as unknown as TRun
}

const runWithRepoRoot = (repoRoot: string): TRun =>
  runWithRoots(repoRoot, repoRoot)

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

const runWithoutRepoRoot = (): TRun => {
  const { run } = traced()
  return run
}

test(
  [
    'given use-cases/gates::diffMatchesClaims',
    'when the orchestrator process cwd sits BELOW run.repoRoot (workspace), not the other way round',
    'it should resolve a claimed path against run.repoRoot rather than process.cwd() -- the defect commit 49b2ab0 fixed',
  ].join(', '),
  () => {
    // given
    /*
     * The INVERSE of the nesting that motivated this spec
     * (specs/todos/FIX-WORKSPACE-AND-VCS-ROOTS.md): here the WORKSPACE is the
     * repo root and the ORCHESTRATOR's own cwd is one level below it in
     * `_newstack`. That is the layout commit 49b2ab0 fixed -- resolving
     * against `run.repoRoot` rather than `process.cwd()` -- and it is a
     * different case from a workspace nested INSIDE a larger VCS root, which
     * the tests below cover.
     *
     * original given — a repo root containing the claimed file, and an orchestrator
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
    'given use-cases/gates::diffMatchesClaims',
    'when a claimed path was deleted during the run but appears in the observed set',
    'it should settle the claim as satisfied, naming it as a deletion',
  ].join(', '),
  () => {
    // given — a repo root WITHOUT the claimed file (it was deleted by the
    // run), but the run's own observed changes name it
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-diff-claims-deleted-'))
    const claimedPath = 'old/removed.txt'

    const run = runWithRepoRoot(repoRoot)
    const envelope = envelopeClaiming([claimedPath])

    // when
    const report = diffMatchesClaims.check(envelope, run, [claimedPath])

    // then — satisfied by observation, not existence, and says so
    expect(violationsOf(report)).toHaveLength(0)
    expect(report.checks[0]?.ok).toBe(true)
    expect(report.checks[0]?.note).toContain('gone from the tree')
    expect(report.checks[0]?.note).toContain('observed as changed by this run')
  },
)

test(
  [
    'given use-cases/gates::diffMatchesClaims',
    'when an envelope claims both the source and destination of a move',
    'it should settle the destination by existence and the source by observation',
  ].join(', '),
  () => {
    // given — a repo root containing only the destination of a move; the
    // source no longer exists on disk
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-diff-claims-move-'))
    mkdirSync(join(repoRoot, 'new'), { recursive: true })
    writeFileSync(join(repoRoot, 'new', 'moved.txt'), 'content\n')

    const sourcePath = 'old/moved.txt'
    const destPath = 'new/moved.txt'

    const run = runWithRepoRoot(repoRoot)
    const envelope = envelopeClaiming([sourcePath, destPath])

    // when — the run observed both halves of the move
    const report = diffMatchesClaims.check(envelope, run, [
      sourcePath,
      destPath,
    ])

    // then — both claims satisfied, for different reasons
    expect(violationsOf(report)).toHaveLength(0)
    expect(report.checks).toHaveLength(2)
    const sourceCheck = report.checks.find((check) => check.item === sourcePath)
    const destCheck = report.checks.find((check) => check.item === destPath)
    expect(sourceCheck?.ok).toBe(true)
    expect(sourceCheck?.note).toContain('gone from the tree')
    expect(destCheck?.ok).toBe(true)
    expect(destCheck?.note).toContain('exists')
  },
)

test(
  [
    'given use-cases/gates::diffMatchesClaims',
    'when a claimed path exists on disk',
    'it should keep the existing note rather than widening into "anything claimed passes"',
  ].join(', '),
  () => {
    // given — a file that exists, and is NOT in the observed set at all
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-diff-claims-exists-'))
    writeFileSync(join(repoRoot, 'kept.txt'), 'content\n')

    const run = runWithRepoRoot(repoRoot)
    const envelope = envelopeClaiming(['kept.txt'])

    // when — the observed set is empty; only existence can satisfy this
    const report = diffMatchesClaims.check(envelope, run, [])

    // then
    expect(violationsOf(report)).toHaveLength(0)
    expect(report.checks[0]?.note).toContain('exists')
    expect(report.checks[0]?.note).not.toContain('observed as changed')
  },
)

test(
  [
    'given use-cases/gates::diffMatchesClaims',
    'when a claim and an observed path name the same file through different spellings (relative vs. absolute)',
    'it should resolve both and treat them as one path, not two strings',
  ].join(', '),
  () => {
    // given
    /*
     * A deleted file the agent claimed by its workspace-relative
     * spelling, and an observed path for the same file given as the
     * resolved absolute path (the spelling `changedPaths` may carry). Both
     * must resolve through the same root resolution (1.1.4) to be
     * recognised as one path rather than two unrelated strings.
     */
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-claims-roots-'))

    const run = runWithRepoRoot(repoRoot)
    const claim = 'nested/sub/removed.txt'
    const envelope = envelopeClaiming([claim])
    const absoluteObserved = join(repoRoot, claim)

    // when — the file does not exist, but the observed path (given as an
    // absolute path) names the same file the claim resolves to
    const report = diffMatchesClaims.check(envelope, run, [absoluteObserved])

    // then — settled as satisfied by observation, same path either way
    expect(violationsOf(report)).toHaveLength(0)
    expect(report.checks[0]?.ok).toBe(true)
    expect(report.checks[0]?.note).toContain('gone from the tree')
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
    'when a relative claim exists under neither run.repoRoot nor process.cwd(), nor the observed set',
    'it should still fail, reporting the claimed spelling',
  ].join(', '),
  () => {
    // given — a repo root that does NOT contain the claimed file, and a run
    // that did not observe it changed either
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-diff-claims-wrong-'))
    const claimedPath = 'out/does-not-exist.txt'

    const run = runWithRepoRoot(repoRoot)
    const envelope = envelopeClaiming([claimedPath])

    // when
    const report = diffMatchesClaims.check(envelope, run, [])

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

test(
  [
    'given use-cases/gates::diffMatchesClaims',
    'when the workspace is nested inside the VCS root and the claim lives above the workspace',
    'it should resolve against the VCS root, naming it in the check, and warn without failing the gate',
  ].join(', '),
  () => {
    // given
    /*
     * The real shape of the run that motivated this spec: a VCS root
     * containing the claimed file, and a workspace ONE LEVEL BELOW the VCS root (the
     * `_newstack` layout), the inverse of the pre-existing fixture above.
     */
    const vcsRootDir = mkdtempSync(join(tmpdir(), 'crust-claims-nested-vcs-'))
    mkdirSync(join(vcsRootDir, '.prodcontainer', 'spotify-gateway'), {
      recursive: true,
    })
    writeFileSync(
      join(vcsRootDir, '.prodcontainer', 'spotify-gateway', 'Dockerfile'),
      'FROM scratch\n',
    )
    const workspaceDir = join(vcsRootDir, '_newstack')
    mkdirSync(workspaceDir, { recursive: true })

    const { run, events } = traced()
    const nested = {
      ...run,
      repoRoot: workspaceDir,
      vcsRoot: vcsRootDir,
    } as unknown as TRun
    const claim = '.prodcontainer/spotify-gateway/Dockerfile'
    const envelope = envelopeClaiming([claim])

    // when
    const report = diffMatchesClaims.check(envelope, nested, [claim])

    // then — resolved, not failed
    expect(violationsOf(report)).toHaveLength(0)
    expect(report.checks[0]?.note).toContain('(vcs)')
    // and — a warning was raised naming the path, never a gate failure
    const warning = events.find((event) => event.name === 'tree_warning')
    expect(warning?.payload).toMatchObject({
      kind: 'outside_workspace',
      paths: [claim],
    })
  },
)

test(
  [
    'given use-cases/gates::diffMatchesClaims',
    'when the workspace equals the VCS root and the claim resolves inside it',
    'it should name the workspace in the check and raise no warning',
  ].join(', '),
  () => {
    // given — the ordinary, unnested case
    const repoRoot = mkdtempSync(join(tmpdir(), 'crust-claims-flat-'))
    writeFileSync(join(repoRoot, 'README.md'), 'hi\n')

    const { run, events } = traced()
    const flat = { ...run, repoRoot, vcsRoot: repoRoot } as unknown as TRun
    const envelope = envelopeClaiming(['README.md'])

    // when
    const report = diffMatchesClaims.check(envelope, flat, ['README.md'])

    // then
    expect(violationsOf(report)).toHaveLength(0)
    expect(report.checks[0]?.note).toContain('(workspace)')
    expect(
      events.find((event) => event.name === 'tree_warning'),
    ).toBeUndefined()
  },
)
