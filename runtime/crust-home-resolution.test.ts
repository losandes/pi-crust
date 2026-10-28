import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/*
 * Issue #24, stage 2 (1.6.1, 1.6.2, 1.6.3, 1.6.4): a linked worktree that was
 * never re-stamped must still run `just crust ...` by resolving the package
 * home through CRUST_HOME, then the stamp's own pointer file, then the
 * pointer file beside the shared git directory that every worktree of one
 * clone names through `git rev-parse --git-common-dir`.
 *
 * These exercise the real `crust.just` template through the real `just`
 * binary against disposable git repositories, because the behaviour under
 * test IS the shell resolution chain `just` evaluates — a TypeScript-level
 * test of the surrounding runtime would not touch it at all.
 */

const CRUST_JUST = join(import.meta.dir, 'crust.just')

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

const justEvaluate = (
  cwd: string,
  variable: string,
  env?: Record<string, string>,
): { readonly stdout: string; readonly status: number } => {
  // This IS the boundary: `just` exits non-zero on a failing recipe, and the
  // test asserts on the failure itself, so the throw becomes the settlement.
  // biome-ignore lint/plugin/no-intermediate-try-catch: converting a failing subprocess exit into an assertable result is this helper's job
  try {
    const stdout = execFileSync(
      'just',
      ['--working-directory', cwd, '--justfile', CRUST_JUST, '--evaluate', variable],
      { cwd, encoding: 'utf8', env: { ...process.env, ...env } },
    )
    return { stdout: stdout.trim(), status: 0 }
  } catch (error) {
    const err = error as { readonly stdout?: string; readonly status?: number }
    return { stdout: (err.stdout ?? '').toString().trim(), status: err.status ?? 1 }
  }
}

const justRecipe = (
  cwd: string,
  recipe: string,
  env?: Record<string, string>,
): { readonly stdout: string; readonly stderr: string; readonly status: number } => {
  // biome-ignore lint/plugin/no-intermediate-try-catch: converting a failing subprocess exit into an assertable result is this helper's job
  try {
    const stdout = execFileSync(
      'just',
      ['--working-directory', cwd, '--justfile', CRUST_JUST, recipe],
      { cwd, encoding: 'utf8', env: { ...process.env, ...env } },
    )
    return { stdout: stdout.trim(), stderr: '', status: 0 }
  } catch (error) {
    const err = error as {
      readonly stdout?: Buffer | string
      readonly stderr?: Buffer | string
      readonly status?: number
    }
    return {
      stdout: (err.stdout ?? '').toString().trim(),
      stderr: (err.stderr ?? '').toString().trim(),
      status: err.status ?? 1,
    }
  }
}

/**
 * A main clone, stamped with a pointer file naming `home`, plus a linked
 * worktree of it that has never been stamped — exactly the shape a developer
 * gets from `git worktree add` with no re-install.
 */
const aPrimaryAndLinkedWorktree = (
  home: string,
): { readonly primary: string; readonly linked: string } => {
  const root = mkdtempSync(join(tmpdir(), 'crust-home-'))
  const primary = join(root, 'primary')
  mkdirSync(primary)
  git(primary, 'init', '-q', '-b', 'main')
  git(primary, 'config', 'user.email', 'tester@example.com')
  git(primary, 'config', 'user.name', 'tester')
  git(primary, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(primary, 'f.txt'), 'x\n')
  git(primary, 'add', '-A')
  git(primary, 'commit', '-qm', 'init')
  mkdirSync(join(primary, '.pi-crust', 'data'), { recursive: true })
  writeFileSync(join(primary, '.pi-crust', 'data', 'pi-crust-home'), `${home}\n`)

  const linked = join(root, 'linked')
  git(primary, 'worktree', 'add', '-q', linked, '-b', 'feature')

  return { primary, linked }
}

// Issue #24 stage 2 (1.6.1) is not implemented yet: the `crust` variable in
// `crust.just` has no git-common-dir fallback. `test.failing` keeps this
// known-red assertion in the suite without breaking the repository-wide
// `bun test` gate; once the chain is implemented this test starts passing,
// which `test.failing` reports as a FAILURE — the signal to drop `.failing`.
test.failing(
  [
    'given crust.just’s crust variable',
    'when evaluated in a linked worktree that was never stamped, with no CRUST_HOME',
    'it should resolve the package home via the pointer file beside the shared git directory',
  ].join(', '),
  () => {
    // given — the worktree itself has no .pi-crust/data/pi-crust-home; only
    // the primary clone it was branched from does.
    const { primary, linked } = aPrimaryAndLinkedWorktree('/fake/package/home')

    // when
    const actual = justEvaluate(linked, 'crust')

    // then — found through `git rev-parse --git-common-dir`, not through a
    // nonexistent local pointer silently reading as empty.
    expect(actual.stdout).toEqual('/fake/package/home/runtime')
    void primary
  },
)

test(
  [
    'given crust.just’s crust variable',
    'when the linked worktree has its own pointer file',
    'it should prefer the worktree’s own pointer over the primary clone’s',
  ].join(', '),
  () => {
    // given — both a primary pointer and a worktree-local pointer exist
    const { linked } = aPrimaryAndLinkedWorktree('/primary/package/home')
    mkdirSync(join(linked, '.pi-crust', 'data'), { recursive: true })
    writeFileSync(
      join(linked, '.pi-crust', 'data', 'pi-crust-home'),
      '/local/package/home\n',
    )

    // when
    const actual = justEvaluate(linked, 'crust')

    // then
    expect(actual.stdout).toEqual('/local/package/home/runtime')
  },
)

test(
  [
    'given crust.just’s crust variable',
    'when CRUST_HOME is exported in a linked worktree that has no pointer file at all',
    'it should use CRUST_HOME rather than falling through the chain',
  ].join(', '),
  () => {
    // given
    const { linked } = aPrimaryAndLinkedWorktree('/primary/package/home')

    // when
    const actual = justEvaluate(linked, 'crust', { CRUST_HOME: '/explicit/home' })

    // then
    expect(actual.stdout).toEqual('/explicit/home')
  },
)

// Issue #24 stage 2 (1.6.4) is not implemented yet: today's failure is a
// bare bun "module not found", naming none of the three resolution links.
test.failing(
  [
    'given crust.just’s crust-dependent recipes',
    'when none of CRUST_HOME, a local pointer, or the shared git directory names a package',
    'it should fail loudly naming all three rather than running bun against a bogus path',
  ].join(', '),
  () => {
    // given — a plain directory: not a git repository, no pointer, no
    // CRUST_HOME. `git rev-parse --git-common-dir` has nothing to answer.
    const dir = mkdtempSync(join(tmpdir(), 'crust-home-nogit-'))

    // when
    const actual = justRecipe(dir, 'list')

    // then — the failure names the repair, not a bun "module not found".
    expect(actual.status).not.toEqual(0)
    const message = `${actual.stdout}\n${actual.stderr}`
    expect(message).toContain('CRUST_HOME')
    expect(message).toContain('pi-crust-home')
    expect(message.toLowerCase()).toContain('git')
  },
)

// Issue #24 stage 2 (1.6.2) is not implemented yet: `update` only checks
// CRUST_HOME and the local pointer, not the git-common-dir fallback.
test.failing(
  [
    'given crust.just’s update recipe',
    'when run in a linked worktree with no local pointer file',
    'it should find the package through the shared git directory rather than reporting it missing',
  ].join(', '),
  () => {
    // given — a primary clone whose pointer names a stub "package" with just
    // enough of a scripts/ directory for `update` to recognise it.
    const root = mkdtempSync(join(tmpdir(), 'crust-home-update-'))
    const fakeHome = join(root, 'fakehome')
    mkdirSync(join(fakeHome, 'scripts'), { recursive: true })
    writeFileSync(
      join(fakeHome, 'scripts', 'install.ts'),
      'console.log("fake-install-ran")\n',
    )
    writeFileSync(
      join(fakeHome, 'scripts', 'verify-install.sh'),
      '#!/usr/bin/env bash\necho "fake-verify-ran"\n',
    )
    chmodSync(join(fakeHome, 'scripts', 'verify-install.sh'), 0o755)
    const { linked } = aPrimaryAndLinkedWorktree(fakeHome)

    // when
    const actual = justRecipe(linked, 'update')

    // then
    expect(actual.status).toEqual(0)
    expect(actual.stdout).toContain('fake-install-ran')
    expect(actual.stdout).toContain('fake-verify-ran')
  },
)

// Issue #24 stage 2 (1.6.2) is not implemented yet: `observe` only checks
// CRUST_HOME and the local pointer, not the git-common-dir fallback.
test.failing(
  [
    'given crust.just’s observe recipe',
    'when run in a linked worktree with no local pointer file',
    'it should find the package through the shared git directory rather than reporting it missing',
  ].join(', '),
  () => {
    // given
    const root = mkdtempSync(join(tmpdir(), 'crust-home-observe-'))
    const fakeHome = join(root, 'fakehome')
    mkdirSync(join(fakeHome, 'scripts'), { recursive: true })
    writeFileSync(
      join(fakeHome, 'scripts', 'observe.ts'),
      'console.log("fake-observe-ran")\n',
    )
    const { linked } = aPrimaryAndLinkedWorktree(fakeHome)

    // when
    const actual = justRecipe(linked, 'observe')

    // then
    expect(actual.status).toEqual(0)
    expect(actual.stdout).toContain('fake-observe-ran')
  },
)
