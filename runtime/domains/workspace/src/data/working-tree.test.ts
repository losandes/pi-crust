import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { historyPaths, snapshotTree } from './working-tree'

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/working-tree::historyPaths with modified, deleted, new and renamed paths',
    'when comparing two commits',
    'it should include both names of a rename (W1)',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    try {
      mkdirSync(join(dir, 'src'))
      for (const name of ['app', 'gone', 'old']) {
        writeFileSync(join(dir, `src/${name}.ts`), `${name}\n`)
      }
      git(dir, 'add', '-A')
      git(dir, 'commit', '-qm', 'A')
      const from = git(dir, 'rev-parse', 'HEAD')
      writeFileSync(join(dir, 'src/app.ts'), 'changed\n')
      rmSync(join(dir, 'src/gone.ts'))
      writeFileSync(join(dir, 'src/new.ts'), 'new\n')
      renameSync(join(dir, 'src/old.ts'), join(dir, 'src/renamed.ts'))
      git(dir, 'add', '-A')
      git(dir, 'commit', '-qm', 'B')

      // when
      const actual = historyPaths({ workspaceRoot: dir, vcsRoot: dir })(
        from,
        git(dir, 'rev-parse', 'HEAD'),
      )

      // then
      expect(actual.toSorted()).toEqual([
        'src/app.ts',
        'src/gone.ts',
        'src/new.ts',
        'src/old.ts',
        'src/renamed.ts',
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/working-tree::historyPaths with a nested workspace',
    'when history changes paths inside and above it',
    'it should normalize paths like snapshotTree (W2)',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    try {
      mkdirSync(join(dir, '_newstack'))
      writeFileSync(join(dir, '_newstack/inside.ts'), 'inside\n')
      writeFileSync(join(dir, 'above.ts'), 'above\n')
      git(dir, 'add', '-A')
      git(dir, 'commit', '-qm', 'A')
      const from = git(dir, 'rev-parse', 'HEAD')
      writeFileSync(join(dir, '_newstack/inside.ts'), 'changed inside\n')
      writeFileSync(join(dir, 'above.ts'), 'changed above\n')
      git(dir, 'add', '-A')
      git(dir, 'commit', '-qm', 'B')

      // when
      const actual = historyPaths({
        workspaceRoot: join(dir, '_newstack'),
        vcsRoot: dir,
      })(from, git(dir, 'rev-parse', 'HEAD'))

      // then
      expect(actual.toSorted()).toEqual(
        ['inside.ts', join(dir, 'above.ts')].toSorted(),
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

for (const [from, to] of [
  ['', 'b'],
  ['a', ''],
  ['a', 'a'],
] as const) {
  test(
    [
      `given data/working-tree::historyPaths with revisions ${JSON.stringify([from, to])}`,
      'when no history comparison is needed',
      'it should return no paths even with nonexistent roots (W3)',
    ].join(', '),
    () => {
      // given
      const roots = {
        workspaceRoot: '/nonexistent/crust-history',
        vcsRoot: '/nonexistent/crust-history',
      }

      // when
      const actual = historyPaths(roots)(from, to)

      // then
      expect(actual).toEqual([])
    },
  )
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/working-tree::historyPaths with an unresolvable revision',
    'when git cannot compare the commits',
    'it should return no paths without throwing (W4)',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    try {
      const from = git(dir, 'rev-parse', 'HEAD')

      // when
      const actual = historyPaths({ workspaceRoot: dir, vcsRoot: dir })(
        from,
        '0'.repeat(40),
      )

      // then
      expect(actual).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** A repository with one commit, so `diff HEAD` has something to be against. */
const aRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-snapshot-'))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'tester@example.com')
  git(dir, 'config', 'user.name', 'tester')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'README.md'), 'before\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'first')

  return dir
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/working-tree::snapshotTree',
    'when the workspace equals the VCS root',
    'it should fingerprint tracked and untracked paths by their ordinary relative spelling, unchanged from before this normalisation',
  ].join(', '),
  () => {
    // given — the ordinary, unnested case
    const dir = aRepo()
    writeFileSync(join(dir, 'README.md'), 'after\n')
    writeFileSync(join(dir, 'new.txt'), 'new\n')

    // when
    const actual = snapshotTree({ workspaceRoot: dir, vcsRoot: dir })

    // then
    expect(Object.keys(actual).toSorted()).toEqual(['README.md', 'new.txt'])
    expect(actual['new.txt']).toEqual('untracked')
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/working-tree::snapshotTree',
    'when the workspace is nested one level inside the VCS root',
    'it should report a path INSIDE the workspace relative to the workspace, and a path ABOVE it as absolute',
  ].join(', '),
  () => {
    // given
    /*
     * Given — `git diff HEAD --numstat` and `git ls-files --others
     * --exclude-standard` both print paths relative to the VCS root
     * regardless of cwd (1.2.1). A workspace one level below it must not
     * have those strings misread as workspace-relative — the defect this
     * spec exists to close.
     */
    const vcsRootDir = aRepo()
    const workspaceDir = join(vcsRootDir, '_newstack')
    mkdirSync(workspaceDir, { recursive: true })
    writeFileSync(
      join(workspaceDir, 'inside.txt'),
      'written inside the workspace\n',
    )
    mkdirSync(join(vcsRootDir, '.prodcontainer'), { recursive: true })
    writeFileSync(
      join(vcsRootDir, '.prodcontainer', 'Dockerfile'),
      'FROM scratch\n',
    )

    // when
    const actual = snapshotTree({
      workspaceRoot: workspaceDir,
      vcsRoot: vcsRootDir,
    })

    // then — workspace-relative inside, absolute above it
    expect(Object.keys(actual).toSorted()).toEqual(
      [
        'inside.txt',
        join(vcsRootDir, '.prodcontainer', 'Dockerfile'),
      ].toSorted(),
    )
  },
)

test(
  [
    'given data/working-tree::snapshotTree',
    'when the directory is not a git repository at all',
    'it should return an empty snapshot rather than throw, covering 1.1.2/1.6.4',
  ].join(', '),
  () => {
    // given — a tree with no `.git` anywhere above it
    const dir = mkdtempSync(join(tmpdir(), 'crust-snapshot-no-git-'))
    writeFileSync(join(dir, 'untracked.txt'), 'nobody is watching\n')

    // when — both roots equal, the fallback `vcsRoot()` gives a tree like this
    const actual = snapshotTree({ workspaceRoot: dir, vcsRoot: dir })

    // then
    expect(actual).toEqual({})
  },
)
