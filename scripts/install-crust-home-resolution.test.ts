import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/*
 * Issue #24, stage 2 (1.6.3): the installer must emit the resolving chain
 * (CRUST_HOME; the stamp's own pointer; the pointer beside the shared git
 * directory) into the `crust` passthrough recipe it writes into a
 * repository's justfile, and a re-stamp of a repository holding the old
 * single-path form must replace it — the same way `repairInterpolation`
 * already replaces the old `{{ARGS}}` body today.
 */

const INSTALL = join(import.meta.dir, 'install.ts')

const aRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-install-home-'))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  return dir
}

const runInstall = (cwd: string, ...args: readonly string[]): void => {
  execFileSync('bun', [INSTALL, ...args], { cwd, encoding: 'utf8' })
}

const crustRecipeBody = (root: string): string => {
  const text = readFileSync(join(root, 'justfile'), 'utf8')
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.startsWith('crust *ARGS:'))
  if (start === -1) {
    throw new Error('no crust recipe found in justfile')
  }
  return lines
    .slice(start + 1)
    .filter((line) => line.startsWith(' ') || line.startsWith('\t'))
    .join('\n')
}

// Issue #24 stage 2 (1.6.3) is not implemented yet: install.ts still emits
// the old single-path `cat .pi-crust/data/pi-crust-home` body. `test.failing`
// keeps this known-red assertion in the suite without breaking the
// repository-wide `bun test` gate; it starts reporting FAILURE once the
// chain is implemented, which is the signal to drop `.failing`.
test.failing(
  [
    'given install.ts',
    'when it stamps a fresh repository',
    'it should write a crust recipe that resolves the package home through CRUST_HOME, the stamp pointer, and the shared git directory, not a bare single-path cat',
  ].join(', '),
  () => {
    // given
    const root = aRepo()

    // when
    runInstall(root)
    const body = crustRecipeBody(root)

    // then — the old form read only `.pi-crust/data/pi-crust-home` with no
    // override and no fallback for a linked worktree.
    expect(body).toContain('CRUST_HOME')
    expect(body.toLowerCase()).toContain('git-common-dir')
  },
)

// Same reason as the test above: not implemented yet.
test.failing(
  [
    'given install.ts',
    'when a repository already carries the old single-path crust recipe and is re-stamped with --force',
    'it should replace it with the resolving form rather than leaving the old body in place',
  ].join(', '),
  () => {
    // given — a repository stamped before this chain existed
    const root = aRepo()
    writeFileSync(
      join(root, 'justfile'),
      [
        'set positional-arguments',
        '',
        'crust *ARGS:',
        '    @bun "$(cat .pi-crust/data/pi-crust-home)/runtime/cli.ts" "$@"',
        '',
      ].join('\n'),
    )

    // when
    runInstall(root, '--force')
    const body = crustRecipeBody(root)

    // then
    expect(body).toContain('CRUST_HOME')
    expect(body.toLowerCase()).toContain('git-common-dir')
  },
)
