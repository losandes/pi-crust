import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { integrationTestsEnabled } from '../src/lib/testing'
import {
  dedupe,
  discover,
  resolveWorkspaces,
  slugify,
  workspaceRootOf,
  worktreePaths,
} from './workspaces.ts'

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** A real git repository, so worktreePaths/discover exercise the real boundary. */
const repo = (name: string): string => {
  // realpathSync: macOS's tmpdir() is itself a symlink, and git reports its
  // own canonical path \u2014 comparing against the non-canonical one here would
  // make the offset arithmetic disagree with what discover() actually sees.
  const root = join(
    realpathSync(mkdtempSync(join(tmpdir(), 'crust-workspaces-git-'))),
    name,
  )
  mkdirSync(root, { recursive: true })
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.email', 'tester@example.com')
  git(root, 'config', 'user.name', 'tester')
  git(root, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(root, 'README.md'), 'hi\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-qm', 'first')
  return root
}

/** A working tree with a trace in it, which is all a workspace has to be. */
const tree = (name: string): string => {
  const root = join(mkdtempSync(join(tmpdir(), 'crust-workspaces-')), name)
  mkdirSync(join(root, '.pi-crust', 'data'), { recursive: true })
  writeFileSync(join(root, '.pi-crust', 'data', 'crust.db'), '')
  return root
}

/**
 * An environment with no registry behind it.
 *
 * Resolution reads the machine's registry by default, which is the point of
 * the feature and a trap for a test: once anything has registered a tree,
 * every unsealed test would start watching it and fail for a reason nothing
 * in the test says.
 */
const sealed = (): Readonly<Record<string, string | undefined>> => ({})

const dbIn = (root: string): string =>
  join(root, '.pi-crust', 'data', 'crust.db')

test(
  [
    'given server/workspaces::resolveWorkspaces',
    'when nothing new is passed',
    'it should resolve exactly the single database it always did',
  ].join(', '),
  () => {
    // given — the contract for every existing invocation. A developer who has
    // never heard of workspaces must get the db they always got.
    const root = tree('solo')

    // when
    const actual = resolveWorkspaces(
      ['bun', 'server', '--db', dbIn(root)],
      sealed(),
    )

    // then
    expect(actual).toEqual([{ label: 'solo', dbPath: dbIn(root), root }])
  },
)

test(
  [
    'given server/workspaces::resolveWorkspaces',
    'when several trees are named with --workspace',
    'it should watch each one, labelled by its own directory',
  ].join(', '),
  () => {
    // given
    const one = tree('feature-a')
    const two = tree('feature-b')

    // when — a tree may be given as the directory rather than the db file
    const actual = resolveWorkspaces(
      ['bun', 'server', '--workspace', one, `--workspace=${dbIn(two)}`],
      sealed(),
    )

    // then
    expect(actual).toEqual([
      { label: 'feature-a', dbPath: dbIn(one), root: one },
      { label: 'feature-b', dbPath: dbIn(two), root: two },
    ])
  },
)

test(
  [
    'given server/workspaces::resolveWorkspaces',
    'when a workspace is given an explicit name',
    'it should use it, slugified so it survives a URL segment',
  ].join(', '),
  () => {
    // given — labels address a workspace in a request path, and most branch
    // names contain a slash, which would split into two segments.
    const root = tree('tree')

    // when
    const actual = resolveWorkspaces(
      ['bun', 'server', '--workspace', `feat/Crust Agent=${root}`],
      sealed(),
    )

    // then
    expect(actual).toEqual([
      { label: 'feat-crust-agent', dbPath: dbIn(root), root },
    ])
  },
)

test(
  [
    'given server/workspaces::resolveWorkspaces',
    'when CRUST_WORKSPACES names the trees',
    'it should read them, and let the flag win over the variable',
  ].join(', '),
  () => {
    // given
    const fromEnv = tree('from-env')
    const fromFlag = tree('from-flag')

    // when
    const viaEnv = resolveWorkspaces(['bun', 'server'], {
      ...sealed(),
      CRUST_WORKSPACES: `${fromEnv},`,
    })
    const viaBoth = resolveWorkspaces(
      ['bun', 'server', '--workspace', fromFlag],
      {
        ...sealed(),
        CRUST_WORKSPACES: fromEnv,
      },
    )

    // then — the empty trailing spec is ignored, not turned into a workspace
    expect(viaEnv).toEqual([
      { label: 'from-env', dbPath: dbIn(fromEnv), root: fromEnv },
    ])
    // then — both are watched, with the flag's entry first
    expect(viaBoth.map((workspace) => workspace.label)).toEqual([
      'from-flag',
      'from-env',
    ])
  },
)

test(
  [
    'given server/workspaces::resolveWorkspaces',
    'when the database comes from CRUST_DB rather than a flag',
    'it should still be the workspace that is watched',
  ].join(', '),
  () => {
    // given — the variable is how the visualizer is normally pointed at a
    // repository, so a resolver that reads the ambient environment instead of
    // the one it was handed silently watches the wrong tree.
    const root = tree('via-env')

    // when
    const actual = resolveWorkspaces(['bun', 'server'], {
      ...sealed(),
      CRUST_DB: dbIn(root),
    })

    // then
    expect(actual).toEqual([{ label: 'via-env', dbPath: dbIn(root), root }])
  },
)

test(
  [
    'given server/workspaces::dedupe',
    'when two entries name the same database',
    'it should keep one, and still address two trees that share a name',
  ].join(', '),
  () => {
    // given — worktrees are routinely named after the same ticket, and a
    // label that is not unique is a label that cannot route.
    const found = [
      {
        label: 'stats',
        dbPath: '/trees/a/.pi-crust/data/crust.db',
        root: '/trees/a',
      },
      {
        label: 'stats',
        dbPath: '/trees/a/.pi-crust/data/crust.db',
        root: '/trees/a',
      },
      {
        label: 'stats',
        dbPath: '/trees/b/.pi-crust/data/crust.db',
        root: '/trees/b',
      },
    ]

    // when
    const actual = dedupe(found)

    // then
    expect(actual).toEqual([
      {
        label: 'stats',
        dbPath: '/trees/a/.pi-crust/data/crust.db',
        root: '/trees/a',
      },
      {
        label: 'stats-2',
        dbPath: '/trees/b/.pi-crust/data/crust.db',
        root: '/trees/b',
      },
    ])
  },
)

test(
  [
    'given server/workspaces::dedupe',
    'when two trees name the same database through different spellings \u2014 a direct path and a symlink to it',
    'it should collapse them by REAL path, so a pooled store is one workspace rather than one per tree that points at it',
  ].join(', '),
  () => {
    // given
    const root = tree('primary')
    const realDb = join(root, '.pi-crust', 'data', 'crust.db')
    const linkedRoot = mkdtempSync(join(tmpdir(), 'crust-workspaces-linked-'))
    const linkedDb = join(linkedRoot, 'crust.db')
    symlinkSync(realDb, linkedDb)
    const found = [
      { label: 'primary', dbPath: realDb, root },
      { label: 'linked', dbPath: linkedDb, root: linkedRoot },
    ]

    // when
    const actual = dedupe(found)

    // then — the first entry's own spelling is kept (1.7.5)
    expect(actual).toEqual([{ label: 'primary', dbPath: realDb, root }])
  },
)

test(
  [
    'given server/workspaces::workspaceRootOf',
    'when asked which tree a database belongs to',
    'it should answer the tree, not the data directory',
  ].join(', '),
  () => {
    // given — every write path is derived from this, so it is worth pinning
    const dbPath = '/trees/a/.pi-crust/data/crust.db'

    // when
    const actual = workspaceRootOf(dbPath)

    // then
    expect(actual).toEqual('/trees/a')
  },
)

test(
  [
    'given server/workspaces::slugify',
    'when a name has nothing usable in it',
    'it should still produce a label rather than an empty path segment',
  ].join(', '),
  () => {
    // given — a label is a URL path segment, and an empty one routes nowhere
    const unusable = '///'
    const ordinary = 'Andy/Feature #2'

    // when
    const actual = [slugify(unusable), slugify(ordinary)]

    // then
    expect(actual).toEqual(['workspace', 'andy-feature-2'])
  },
)

test(
  [
    'given server/workspaces::resolveWorkspaces',
    'when a workspace is named explicitly',
    'it should watch only that, ignoring the registry',
  ].join(', '),
  () => {
    // given — naming trees is how a developer narrows to a subset, and a
    // default that overrode it would make the flag useless
    const named = tree('named')
    const registered = tree('registered')
    const file = join(
      mkdtempSync(join(tmpdir(), 'crust-reg-')),
      'workspaces.jsonl',
    )
    writeFileSync(
      file,
      `${JSON.stringify({ root: registered, db: dbIn(registered) })}\n`,
    )

    // when
    const actual = resolveWorkspaces(
      ['bun', 'server', '--workspace', named],
      {},
    )

    // then
    expect(actual).toEqual([
      { label: 'named', dbPath: dbIn(named), root: named },
    ])
  },
)

test(
  [
    'given server/workspaces::dedupe',
    'when two entries name the same database',
    'it should preserve the root of the entry it keeps',
  ].join(', '),
  () => {
    // given
    const found = [
      {
        label: 'stats',
        dbPath: '/trees/a/.pi-crust/data/crust.db',
        root: '/trees/a',
      },
      {
        label: 'stats',
        dbPath: '/trees/a/.pi-crust/data/crust.db',
        root: '/trees/a',
      },
    ]

    // when
    const actual = dedupe(found)

    // then
    expect(actual).toEqual([
      {
        label: 'stats',
        dbPath: '/trees/a/.pi-crust/data/crust.db',
        root: '/trees/a',
      },
    ])
  },
)

test.skipIf(!integrationTestsEnabled)(
  [
    'given server/workspaces::worktreePaths',
    'when the root is a real git repository with linked worktrees',
    'it should list the main worktree and every linked one',
  ].join(', '),
  () => {
    // given
    const root = repo('main')
    const linkedPath = join(root, '..', 'linked')
    git(root, 'worktree', 'add', '-q', linkedPath, '-b', 'topic')

    // when
    const actual = worktreePaths(root)

    // then
    expect(actual.length).toBe(2)
    expect(actual.some((path) => path.endsWith('main'))).toBe(true)
    expect(actual.some((path) => path.endsWith('linked'))).toBe(true)
  },
)

test(
  [
    'given server/workspaces::worktreePaths',
    'when the root is not a git repository at all',
    'it should report no worktrees rather than throw',
  ].join(', '),
  () => {
    // given
    const root = mkdtempSync(join(tmpdir(), 'crust-not-a-repo-'))

    // when
    const actual = worktreePaths(root)

    // then
    expect(actual).toEqual([])
  },
)

test.skipIf(!integrationTestsEnabled)(
  [
    'given server/workspaces::discover',
    'when a linked worktree holds a database at the same offset',
    'it should find it, labelled by the worktree directory name',
  ].join(', '),
  () => {
    // given
    const root = repo('primary')
    const linkedPath = join(root, '..', 'secondary')
    git(root, 'worktree', 'add', '-q', linkedPath, '-b', 'topic')
    mkdirSync(join(root, '.pi-crust', 'data'), { recursive: true })
    writeFileSync(join(root, '.pi-crust', 'data', 'crust.db'), '')
    mkdirSync(join(linkedPath, '.pi-crust', 'data'), { recursive: true })
    writeFileSync(join(linkedPath, '.pi-crust', 'data', 'crust.db'), '')

    // when
    const actual = discover(join(root, '.pi-crust', 'data', 'crust.db'))

    // then \u2014 every worktree that carries a database at the same offset,
    // including this one
    expect(actual.map((workspace) => workspace.label)).toEqual([
      'primary',
      'secondary',
    ])
  },
)

test(
  [
    'given server/workspaces::discover',
    'when the database is not inside a git repository',
    'it should find nothing, rather than throw',
  ].join(', '),
  () => {
    // given
    const notARepo = mkdtempSync(join(tmpdir(), 'crust-discover-no-git-'))
    mkdirSync(join(notARepo, '.pi-crust', 'data'), { recursive: true })
    const dbPath = join(notARepo, '.pi-crust', 'data', 'crust.db')
    writeFileSync(dbPath, '')

    // when
    const actual = discover(dbPath)

    // then
    expect(actual).toEqual([])
  },
)

test.skipIf(!integrationTestsEnabled)(
  [
    'given server/workspaces::discover',
    'when the database sits outside the repository it was found under',
    'it should find nothing, since there is no offset to apply elsewhere',
  ].join(', '),
  () => {
    // given — a repository root with a database that lives above it
    const root = repo('offset-outside')
    const outsideDb = join(root, '..', 'crust.db')
    writeFileSync(outsideDb, '')

    // when
    const actual = discover(outsideDb)

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given old machine registration and launch-directory hints',
    'when resolving default stores',
    'it should ignore both and show exactly the selected shared store',
  ].join(', '),
  () => {
    // given
    const home = tree('machine')
    const elsewhere = tree('other')
    writeFileSync(
      join(home, '.pi-crust/workspaces.jsonl'),
      JSON.stringify({ root: elsewhere, db: dbIn(elsewhere) }),
    )
    // when
    const actual = resolveWorkspaces([], {
      HOME: home,
      CRUST_DB: dbIn(home),
      CRUST_WORKSPACE_ROOT: elsewhere,
    })
    // then
    expect(actual).toEqual([
      { label: 'machine', root: home, dbPath: dbIn(home) },
    ])
  },
)
