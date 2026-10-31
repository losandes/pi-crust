import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  dedupe,
  readRegistry,
  registryStamp,
  resolveWorkspaces,
  slugify,
  workspaceRootOf,
} from './workspaces.ts'

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
const sealed = (): Readonly<Record<string, string | undefined>> => ({
  CRUST_REGISTRY: join(
    mkdtempSync(join(tmpdir(), 'crust-no-registry-')),
    'none.jsonl',
  ),
})

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
    expect(actual).toEqual([{ label: 'solo', dbPath: dbIn(root) }])
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
      { label: 'feature-a', dbPath: dbIn(one) },
      { label: 'feature-b', dbPath: dbIn(two) },
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
    expect(actual).toEqual([{ label: 'feat-crust-agent', dbPath: dbIn(root) }])
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
    expect(viaEnv).toEqual([{ label: 'from-env', dbPath: dbIn(fromEnv) }])
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
    expect(actual).toEqual([{ label: 'via-env', dbPath: dbIn(root) }])
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
      { label: 'stats', dbPath: '/trees/a/.pi-crust/data/crust.db' },
      { label: 'stats', dbPath: '/trees/a/.pi-crust/data/crust.db' },
      { label: 'stats', dbPath: '/trees/b/.pi-crust/data/crust.db' },
    ]

    // when
    const actual = dedupe(found)

    // then
    expect(actual).toEqual([
      { label: 'stats', dbPath: '/trees/a/.pi-crust/data/crust.db' },
      { label: 'stats-2', dbPath: '/trees/b/.pi-crust/data/crust.db' },
    ])
  },
)

test(
  [
    'given server/workspaces::dedupe',
    'when two trees name the same database through different spellings \u2014 a direct path and a symlink to it',
    'it should collapse them by REAL path, so a pooled store is one workspace rather than one per tree that points at it (1.7.5)',
  ].join(', '),
  () => {
    // given
    const root = tree('primary')
    const realDb = join(root, '.pi-crust', 'data', 'crust.db')
    const linkedRoot = mkdtempSync(join(tmpdir(), 'crust-workspaces-linked-'))
    const linkedDb = join(linkedRoot, 'crust.db')
    symlinkSync(realDb, linkedDb)
    const found = [
      { label: 'primary', dbPath: realDb },
      { label: 'linked', dbPath: linkedDb },
    ]

    // when
    const actual = dedupe(found)

    // then — the first entry's own spelling is kept
    expect(actual).toEqual([{ label: 'primary', dbPath: realDb }])
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
    'when trees have registered themselves on this machine',
    'it should watch all of them by default, local tree first',
  ].join(', '),
  () => {
    // given — a developer with five agents running wants one page, not five
    // flags. The registry only holds trees the factory has actually run in,
    // so watching all of them cannot sprawl into unrelated checkouts.
    const here = tree('here')
    const elsewhere = tree('elsewhere')
    const file = join(
      mkdtempSync(join(tmpdir(), 'crust-reg-')),
      'workspaces.jsonl',
    )
    writeFileSync(
      file,
      `${JSON.stringify({ root: elsewhere, db: dbIn(elsewhere) })}\n`,
    )

    // when
    const actual = resolveWorkspaces(['bun', 'server'], {
      CRUST_DB: dbIn(here),
      CRUST_REGISTRY: file,
    })

    // then — the tree you are standing in is never the one missing
    expect(actual).toEqual([
      { label: 'here', dbPath: dbIn(here) },
      { label: 'elsewhere', dbPath: dbIn(elsewhere) },
    ])
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
    const actual = resolveWorkspaces(['bun', 'server', '--workspace', named], {
      CRUST_REGISTRY: file,
    })

    // then
    expect(actual).toEqual([{ label: 'named', dbPath: dbIn(named) }])
  },
)

test(
  [
    'given server/workspaces::readRegistry',
    'when the file holds a repeat, a torn line and a bad record',
    'it should return each database once and skip what it cannot read',
  ].join(', '),
  () => {
    // given — the factory appends, so repeats are expected, and a reader can
    // catch a writer mid-line
    const file = join(
      mkdtempSync(join(tmpdir(), 'crust-reg-')),
      'workspaces.jsonl',
    )
    writeFileSync(
      file,
      [
        JSON.stringify({
          root: '/trees/a',
          db: '/trees/a/.pi-crust/data/crust.db',
        }),
        JSON.stringify({
          root: '/trees/a',
          db: '/trees/a/.pi-crust/data/crust.db',
        }),
        JSON.stringify({ root: '/trees/b' }),
        '{"root":"/trees/c","db":"/trees/c/.pi',
      ].join('\n'),
    )

    // when
    const actual = readRegistry(file)

    // then
    expect(actual).toEqual([
      { label: 'a', dbPath: '/trees/a/.pi-crust/data/crust.db' },
    ])
  },
)

test(
  [
    'given server/workspaces::registryStamp',
    'when the registry does not exist and when it changes',
    'it should report a stamp that moves, so a reader knows to look again',
  ].join(', '),
  () => {
    // given — this is the gate that lets a tree added mid-session appear
    // without restarting the server
    const file = join(
      mkdtempSync(join(tmpdir(), 'crust-reg-')),
      'workspaces.jsonl',
    )
    const absent = registryStamp(file)

    // when
    writeFileSync(file, `${JSON.stringify({ root: '/t', db: '/t/x.db' })}\n`)
    const present = registryStamp(file)

    // then
    expect(absent).toEqual(0)
    expect(present).toBeGreaterThan(0)
  },
)
