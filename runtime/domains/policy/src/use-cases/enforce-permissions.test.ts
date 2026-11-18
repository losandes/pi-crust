import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TAgentConfig,
  TPiCrustConfig,
  TRun,
} from '../../../../lib/contracts'
import { crustConfigSchema } from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { commitPaths, snapshotTree } from '../../../workspace'
import {
  alwaysWritable,
  changedPaths,
  commitBreach,
  declaredBy,
  enforcePermissions,
  handoffDocument,
  matchesPattern,
  permitted,
  resolveWrites,
} from './enforce-permissions'

const configWith = (
  agents: ReadonlyArray<Partial<TAgentConfig> & Readonly<{ name: string }>>,
): TPiCrustConfig =>
  crustConfigSchema.parse({
    defaults: {
      protected_files: ['.pi-crust/config/', 'tools/release/*.ts'],
      data_dir: '.pi-crust/data',
    },
    agents: agents.map((agent) => ({
      prompt_engineering: { system: 's.md', user: 'u.md' },
      ...agent,
    })),
  })

const agentNamed = (cfg: TPiCrustConfig, name: string): TAgentConfig => {
  const agent = cfg.agents.find((candidate) => candidate.name === name)
  if (agent === undefined) {
    throw new Error(`test fixture has no agent ${name}`)
  }
  return agent
}

test(
  [
    'given use-cases/enforce-permissions::matchesPattern',
    'when the pattern uses a single star',
    'it should match within one segment and not across a slash',
  ].join(', '),
  () => {
    // given
    const pattern = 'tools/release/*.ts'

    // when
    const withinSegment = matchesPattern('tools/release/cut.ts', pattern)
    const acrossSlash = matchesPattern('tools/release/nested/cut.ts', pattern)

    // then
    expect(withinSegment).toEqual(true)
    expect(acrossSlash).toEqual(false)
  },
)

test(
  [
    'given use-cases/enforce-permissions::matchesPattern',
    'when the pattern uses a double star',
    'it should cross path separators',
  ].join(', '),
  () => {
    // given
    const pattern = '**/*.md'

    // when
    const actual = matchesPattern('docs/deep/nested/readme.md', pattern)

    // then
    expect(actual).toEqual(true)
  },
)

test(
  [
    'given use-cases/enforce-permissions::matchesPattern',
    'when the pattern ends in a slash',
    'it should be treated as a directory prefix',
  ].join(', '),
  () => {
    // given
    const pattern = 'specs/'

    // when
    const inside = matchesPattern('specs/a/b/c.md', pattern)
    const sibling = matchesPattern('specifications/a.md', pattern)

    // then
    expect(inside).toEqual(true)
    expect(sibling).toEqual(false)
  },
)

test(
  [
    'given use-cases/enforce-permissions::permitted',
    'when a read-only agent targets the session runtime',
    'it should be allowed to write its own report',
  ].join(', '),
  () => {
    // given
    const cfg = configWith([{ name: 'scout', writes: [] }])

    // when
    const actual = permitted(
      '.pi-crust/data/sessions/abc/context_handoff/findings.md',
      agentNamed(cfg, 'scout'),
      cfg,
    )

    // then
    expect(actual).toEqual(true)
  },
)

test(
  [
    'given use-cases/enforce-permissions::permitted',
    'when a read-only agent targets a repo file',
    'it should be refused',
  ].join(', '),
  () => {
    // given
    const cfg = configWith([{ name: 'scout', writes: [] }])

    // when
    const actual = permitted('src/server.ts', agentNamed(cfg, 'scout'), cfg)

    // then
    expect(actual).toEqual(false)
  },
)

test(
  [
    'given use-cases/enforce-permissions::permitted',
    'when an unrestricted agent targets a protected path',
    'it should be refused because it never named it',
  ].join(', '),
  () => {
    // given
    const cfg = configWith([{ name: 'builder', writes: ['*'] }])

    // when
    const protectedPath = permitted(
      '.pi-crust/config/crust.config.yaml',
      agentNamed(cfg, 'builder'),
      cfg,
    )
    const ordinaryPath = permitted(
      'src/server.ts',
      agentNamed(cfg, 'builder'),
      cfg,
    )

    // then
    expect(protectedPath).toEqual(false)
    expect(ordinaryPath).toEqual(true)
  },
)

test(
  [
    'given use-cases/enforce-permissions::permitted',
    'when an agent names a protected path in its own writes',
    'it should be unlocked for that agent only',
  ].join(', '),
  () => {
    // given
    const cfg = configWith([
      { name: 'maintainer', writes: ['.pi-crust/config/'] },
      { name: 'builder', writes: ['*'] },
    ])

    // when
    const unlocked = permitted(
      '.pi-crust/config/crust.config.yaml',
      agentNamed(cfg, 'maintainer'),
      cfg,
    )
    const stillBarred = permitted(
      '.pi-crust/config/crust.config.yaml',
      agentNamed(cfg, 'builder'),
      cfg,
    )

    // then
    expect(unlocked).toEqual(true)
    expect(stillBarred).toEqual(false)
  },
)

test(
  [
    'given use-cases/enforce-permissions::changedPaths',
    'when a path was dirty before and is clean after',
    'it should report the reversion as a change',
  ].join(', '),
  () => {
    // given
    const before = { 'src/a.ts': '3,1', 'src/b.ts': '1,0' }
    const after = { 'src/b.ts': '1,0', 'src/c.ts': 'untracked' }

    // when
    const actual = changedPaths(before, after)

    // then
    expect(actual).toEqual(['src/a.ts', 'src/c.ts'])
  },
)

test(
  [
    'given use-cases/enforce-permissions::permitted',
    'when an agent declares an empty writes list',
    'it should be refused everywhere, because nothing grants it anything',
  ].join(', '),
  () => {
    // given
    const cfg = configWith([{ name: 'scout', writes: [] }])

    // when
    const actual = permitted('src/server.ts', agentNamed(cfg, 'scout'), cfg)

    // then
    expect(actual).toEqual(false)
  },
)

test(
  [
    'given use-cases/enforce-permissions::resolveWrites',
    'when a pattern names the handoff directory by token',
    'it should become a path relative to the repository root',
  ].join(', '),
  () => {
    // given
    const given = ['{handoff}/review.md', 'specs/']

    // when
    const actual = resolveWrites(
      given,
      '/repo',
      '/repo/.pi-crust/data/sessions/abc/context_handoff',
    )

    // then
    expect(actual).toEqual([
      '.pi-crust/data/sessions/abc/context_handoff/review.md',
      'specs/',
    ])
  },
)

test(
  [
    'given use-cases/enforce-permissions::resolveWrites',
    'when the handoff directory sits outside the repository',
    'it should stay absolute, so no snapshot path can ever match it',
  ].join(', '),
  () => {
    // given
    const given = ['{handoff}/review.md']

    // when
    const actual = resolveWrites(given, '/repo', '/elsewhere/handoff')

    // then
    expect(actual).toEqual(['/elsewhere/handoff/review.md'])
  },
)

test(
  [
    'given use-cases/enforce-permissions::handoffDocument',
    'when an agent declares a handoff document among other paths',
    'it should name that document, so the prompt and the permission agree',
  ].join(', '),
  () => {
    // given
    const given = ['{handoff}/plan.md', 'specs/']

    // when
    const actual = handoffDocument(given, '/repo', '/repo/handoff')

    // then
    expect(actual).toEqual('handoff/plan.md')
  },
)

test(
  [
    'given use-cases/enforce-permissions::handoffDocument',
    'when an agent writes only repository paths',
    'it should name nothing rather than mistake a glob for its document',
  ].join(', '),
  () => {
    // given
    const given = ['**/*.test.ts', '**/tests/']

    // when
    const actual = handoffDocument(given, '/repo', '/repo/handoff')

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given use-cases/enforce-permissions::permitted',
    'when a path belongs to an activity running alongside this one',
    "it should be that activity's, because disjointness was checked at load",
  ].join(', '),
  () => {
    // given
    const cfg = configWith([
      { name: 'reviewer', writes: ['reviews/'] },
      { name: 'code-reviewer', writes: ['code-reviews/'] },
    ])

    // when
    const mine = permitted('reviews/x.md', agentNamed(cfg, 'reviewer'), cfg)
    const theirs = permitted(
      'code-reviews/x.md',
      agentNamed(cfg, 'reviewer'),
      cfg,
    )

    // then
    expect(mine).toEqual(true)
    expect(theirs).toEqual(false)
  },
)

test(
  [
    'given use-cases/enforce-permissions::commitBreach',
    'when an activity that was not committing moved HEAD',
    'it should be reported as a breach, like any other overstep',
  ].join(', '),
  () => {
    // given
    /*
     * No prompt asks an agent to commit, but a prompt is advice.
     * Without this check `--commit false` would stop the engine while
     * leaving an agent free to commit with `bash`, and the run would be
     * reported as having made no commits while carrying one.
     */
    const given = {
      tree: {},
      head: 'a'.repeat(40),
      committing: false,
    }

    // when
    const actual = commitBreach(given, {
      tree: {},
      head: 'b'.repeat(40),
      history: [],
    })
    const unchanged = commitBreach(given, {
      tree: {},
      head: given.head,
      history: [],
    })

    // then
    expect(unchanged).toEqual([])
    expect(actual).toHaveLength(1)
    expect(actual[0]).toContain('HEAD moved from aaaaaaa')
    expect(actual[0]).toContain('was not committing')
  },
)

test(
  [
    'given use-cases/enforce-permissions::commitBreach',
    'when the activity was the one committing',
    'it should say nothing, because the commit is what it was asked for',
  ].join(', '),
  () => {
    // given
    const given = { tree: {}, head: 'a'.repeat(40), committing: true }

    // when
    const actual = commitBreach(given, {
      tree: {},
      head: 'b'.repeat(40),
      history: [],
    })

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/enforce-permissions::commitBreach',
    'when there is no history to have moved',
    'it should say nothing rather than invent a breach outside a repository',
  ].join(', '),
  () => {
    // given — '' is what a run outside a git repository records
    const given = { tree: {}, head: '', committing: false }

    // when
    const actual = commitBreach(given, {
      tree: {},
      head: 'b'.repeat(40),
      history: [],
    })

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/enforce-permissions::commitBreach',
    'when the after snapshot has no history',
    'it should report no commit breach outside a repository',
  ].join(', '),
  () => {
    // given
    const before = { tree: {}, head: 'a'.repeat(40), committing: false }

    // when
    const actual = commitBreach(before, { tree: {}, head: '', history: [] })

    // then
    expect(actual).toEqual([])
  },
)

/** A repository with one commit, so a working-tree diff has a HEAD to be against. */
const aRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-permissions-'))
  const git = (...args: readonly string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'tester@example.com')
  git('config', 'user.name', 'tester')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'README.md'), 'committed\n')
  git('add', '-A')
  git('commit', '-qm', 'first')

  return dir
}

const runIn = (dir: string, cfg: TPiCrustConfig): TRun =>
  ({
    cfg,
    repoRoot: dir,
    vcsRoot: dir,
    contextHandoffDir: join(dir, '.pi-crust/data/sessions/abc/context_handoff'),
  }) as unknown as TRun

test(
  [
    'given use-cases/enforce-permissions::enforcePermissions',
    'when an agent changed a tracked file outside its writes',
    'it should report the overstep and leave the new content exactly as it is',
  ].join(', '),
  () => {
    // given
    /*
     * This used to run `git checkout --` on the path, which has no
     * undo: the content was not in a commit, not in the index and not in a
     * stash. The guess about whose edit it was is wrong whenever a developer
     * is typing in the same tree, which is a supported way to work.
     */
    const dir = mkdtempSync(join(tmpdir(), 'crust-permissions-'))
    try {
      const cfg = configWith([{ name: 'reviewer', writes: ['reviews/'] }])
      const before = {}
      const after = { 'README.md': '1,1' }
      writeFileSync(join(dir, 'README.md'), 'changed while the run worked\n')

      // when
      const actual = enforcePermissions(
        runIn(dir, cfg),
        agentNamed(cfg, 'reviewer'),
        { tree: before, head: '', committing: false },
        { tree: after, head: '', history: [] },
      )

      // then — named, and still on disk
      expect(actual.overstepped).toEqual(['README.md'])
      expect(readFileSync(join(dir, 'README.md'), 'utf8')).toEqual(
        'changed while the run worked\n',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

test(
  [
    'given use-cases/enforce-permissions::enforcePermissions',
    'when a file nobody declared appeared while an agent ran',
    'it should report it and never delete it',
  ].join(', '),
  () => {
    // given — an untracked file used to be unlinked on sight
    const dir = mkdtempSync(join(tmpdir(), 'crust-permissions-'))
    try {
      const cfg = configWith([{ name: 'reviewer', writes: ['reviews/'] }])
      const before = {}
      const after = { 'notes.md': 'untracked' }
      writeFileSync(join(dir, 'notes.md'), 'mine\n')

      // when
      const actual = enforcePermissions(
        runIn(dir, cfg),
        agentNamed(cfg, 'reviewer'),
        { tree: before, head: '', committing: false },
        { tree: after, head: '', history: [] },
      )

      // then
      expect(actual.overstepped).toEqual(['notes.md'])
      expect(existsSync(join(dir, 'notes.md'))).toEqual(true)
      expect(readFileSync(join(dir, 'notes.md'), 'utf8')).toEqual('mine\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/enforce-permissions::enforcePermissions',
    'when a concurrent sibling declared the path that changed',
    'it should leave it out of what this Activity will commit',
  ].join(', '),
  () => {
    // given
    /*
     * Attribution between siblings is a question of WHERE, not WHEN:
     * each one's diff contains the other's writes, and a commit scope built
     * from the window would carry a neighbour's half-written file.
     */
    const dir = aRepo()
    const cfg = configWith([
      { name: 'reviewer', writes: ['reviews/'] },
      { name: 'code-reviewer', writes: ['code-reviews/'] },
    ])
    const before = snapshotTree({ workspaceRoot: dir, vcsRoot: dir })
    mkdirSync(join(dir, 'reviews'))
    mkdirSync(join(dir, 'code-reviews'))
    writeFileSync(join(dir, 'reviews/mine.md'), 'mine\n')
    writeFileSync(join(dir, 'code-reviews/theirs.md'), 'theirs\n')

    // when
    const actual = enforcePermissions(
      runIn(dir, cfg),
      agentNamed(cfg, 'reviewer'),
      { tree: before, head: '', committing: false },
      {
        tree: snapshotTree({ workspaceRoot: dir, vcsRoot: dir }),
        head: '',
        history: [],
      },
      [agentNamed(cfg, 'code-reviewer')],
    )

    // then — the sibling's declared path is neither this Activity's to commit
    // nor its overstep to answer for
    expect(actual.touched).toEqual(['reviews/mine.md'])
    expect(actual.overstepped).toEqual([])
  },
)

test(
  [
    'given use-cases/enforce-permissions::declaredBy',
    'when a sibling says it writes anywhere',
    'it should own nothing, because ownership has to be narrower than permission',
  ].join(', '),
  () => {
    // given — an unrestricted neighbour would otherwise own the whole tree,
    // and this Activity would commit none of its own work
    const given = ['*']

    // when
    const actual = declaredBy('src/server.ts', given)

    // then
    expect(actual).toEqual(false)
  },
)

test(
  [
    'given use-cases/enforce-permissions::alwaysWritable',
    'when a handoff directory is passed',
    'it should grant it alongside data_dir, not instead of it',
  ].join(', '),
  () => {
    // given
    const cfg = crustConfigSchema.parse({
      defaults: { data_dir: '.pi-crust/data' },
    })

    // when
    const actual = alwaysWritable(cfg, 'specs/abc/')

    // then
    expect(actual).toEqual(['.pi-crust/data/', 'specs/abc/'])
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/enforce-permissions::enforcePermissions',
    'when --handoff relocated the directory outside data_dir, and an agent wrote there without declaring it',
    'it should NOT be reported as an overstep, because recording its own work is a grant every agent gets',
  ].join(', '),
  () => {
    // given — a relocated handoff directory is outside the data_dir grant
    // unless alwaysWritable widens to match it
    const dir = aRepo()
    const cfg = configWith([{ name: 'reviewer', writes: ['reviews/'] }])
    const handoffDir = join(dir, 'specs', 'abc')
    mkdirSync(handoffDir, { recursive: true })
    const run = {
      cfg,
      repoRoot: dir,
      vcsRoot: dir,
      contextHandoffDir: handoffDir,
    } as unknown as TRun
    const before = snapshotTree({ workspaceRoot: dir, vcsRoot: dir })
    writeFileSync(join(handoffDir, 'plan.md'), 'mine\n')

    // when
    const actual = enforcePermissions(
      run,
      agentNamed(cfg, 'reviewer'),
      { tree: before, head: '', committing: false },
      {
        tree: snapshotTree({ workspaceRoot: dir, vcsRoot: dir }),
        head: '',
        history: [],
      },
    )

    // then
    expect(actual.touched).toContain('specs/abc/plan.md')
    expect(actual.overstepped).toEqual([])
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/enforce-permissions::enforcePermissions',
    'when the same agent writes somewhere else in the repository it never declared',
    'it should still be reported, which is what proves the handoff grant is not a blanket allow',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    const cfg = configWith([{ name: 'reviewer', writes: ['reviews/'] }])
    const handoffDir = join(dir, 'specs', 'abc')
    mkdirSync(handoffDir, { recursive: true })
    const run = {
      cfg,
      repoRoot: dir,
      vcsRoot: dir,
      contextHandoffDir: handoffDir,
    } as unknown as TRun
    const before = snapshotTree({ workspaceRoot: dir, vcsRoot: dir })
    writeFileSync(join(dir, 'notes.md'), 'undeclared\n')

    // when
    const actual = enforcePermissions(
      run,
      agentNamed(cfg, 'reviewer'),
      { tree: before, head: '', committing: false },
      {
        tree: snapshotTree({ workspaceRoot: dir, vcsRoot: dir }),
        head: '',
        history: [],
      },
    )

    // then
    expect(actual.overstepped).toEqual(['notes.md'])
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/enforce-permissions::enforcePermissions',
    'when the workspace is nested one level inside the VCS root and a file changes ABOVE it',
    'it should snapshot, report, and commit the path above the workspace',
  ].join(', '),
  () => {
    // given
    /*
     * The real layout that motivated this spec: a VCS root with a
     * WORKSPACE nested one level below the root (`_newstack`), and an Activity
     * that changed a file ABOVE the workspace \u2014 inside the repository, but
     * not inside the directory the agent was spawned to work in.
     */
    const vcsRootDir = aRepo()
    const workspaceDir = join(vcsRootDir, '_newstack')
    mkdirSync(workspaceDir, { recursive: true })
    const cfg = configWith([{ name: 'builder', writes: ['*'] }])
    const before = snapshotTree({
      workspaceRoot: workspaceDir,
      vcsRoot: vcsRootDir,
    })
    mkdirSync(join(vcsRootDir, '.prodcontainer', 'spotify-gateway'), {
      recursive: true,
    })
    writeFileSync(
      join(vcsRootDir, '.prodcontainer', 'spotify-gateway', 'Dockerfile'),
      'FROM scratch\n',
    )
    const run = {
      cfg,
      repoRoot: workspaceDir,
      vcsRoot: vcsRootDir,
      contextHandoffDir: join(
        workspaceDir,
        '.pi-crust/data/sessions/abc/context_handoff',
      ),
    } as unknown as TRun

    // when — snapshotted and resolved
    const actual = enforcePermissions(
      run,
      agentNamed(cfg, 'builder'),
      { tree: before, head: '', committing: true },
      {
        tree: snapshotTree({
          workspaceRoot: workspaceDir,
          vcsRoot: vcsRootDir,
        }),
        head: '',
        history: [],
      },
    )

    // then — reported as OUTSIDE the workspace: the normalised spelling of
    // a path above it is absolute, which no workspace-relative `writes`
    // pattern could ever have meant
    const absoluteDockerfile = join(
      vcsRootDir,
      '.prodcontainer',
      'spotify-gateway',
      'Dockerfile',
    )
    expect(actual.touched).toEqual([absoluteDockerfile])
    expect(actual.overstepped).toEqual([])

    // and \u2014 staged and committed, addressed from the VCS root: this is the
    // defect itself (`nothing to commit` for a path above the workspace),
    // closed by `commitPaths` taking an explicit `cwd`
    const committed = commitPaths(
      'feat: container config above the workspace',
      actual.touched,
      vcsRootDir,
    )
    expect(committed.sha).not.toEqual('')
    expect(committed.paths).toEqual([
      '.prodcontainer/spotify-gateway/Dockerfile',
    ])
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/enforce-permissions::enforcePermissions',
    'when the workspace is nested inside the VCS root and `writes` names only a workspace-relative pattern',
    'it should still report a file changed ABOVE the workspace as an overstep, because 1.6.5 of',
    'specs/todos/FIX-WORKSPACE-AND-VCS-ROOTS.md keeps `writes` resolving against the workspace root,',
    "unaffected by the VCS root \u2014 unlike the `writes: ['*']` case covered above",
  ].join(', '),
  () => {
    // given
    /*
     * The same nested layout as 1.6.1, but an agent restricted to a
     * workspace-relative pattern that would ALSO happen to match the VCS-root-
     * relative spelling of the changed file, if resolution were ever to drift
     * onto the wrong root. Config resolution (`writes`) must stay blind to
     * `vcsRoot` entirely, so neither spelling may satisfy it.
     */
    const vcsRootDir = aRepo()
    const workspaceDir = join(vcsRootDir, '_newstack')
    mkdirSync(workspaceDir, { recursive: true })
    const cfg = configWith([
      { name: 'builder', writes: ['.prodcontainer/spotify-gateway/*'] },
    ])
    const before = snapshotTree({
      workspaceRoot: workspaceDir,
      vcsRoot: vcsRootDir,
    })
    mkdirSync(join(vcsRootDir, '.prodcontainer', 'spotify-gateway'), {
      recursive: true,
    })
    writeFileSync(
      join(vcsRootDir, '.prodcontainer', 'spotify-gateway', 'Dockerfile'),
      'FROM scratch\n',
    )
    const run = {
      cfg,
      repoRoot: workspaceDir,
      vcsRoot: vcsRootDir,
      contextHandoffDir: join(
        workspaceDir,
        '.pi-crust/data/sessions/abc/context_handoff',
      ),
    } as unknown as TRun

    // when
    const actual = enforcePermissions(
      run,
      agentNamed(cfg, 'builder'),
      { tree: before, head: '', committing: true },
      {
        tree: snapshotTree({
          workspaceRoot: workspaceDir,
          vcsRoot: vcsRootDir,
        }),
        head: '',
        history: [],
      },
    )

    // then \u2014 touched (the engine still sees and can commit it), but NOT
    // permitted: a workspace-relative `writes` pattern cannot name a path
    // whose normalised spelling is absolute, by construction
    const absoluteDockerfile = join(
      vcsRootDir,
      '.prodcontainer',
      'spotify-gateway',
      'Dockerfile',
    )
    expect(actual.touched).toEqual([absoluteDockerfile])
    expect(actual.overstepped).toEqual([absoluteDockerfile])
  },
)

for (const scenario of [
  {
    name: 'U1: an unauthorized commit outside writes',
    writes: ['reviews/'],
    committing: false,
    before: {},
    after: {},
    history: ['src/app.ts'],
    touched: ['src/app.ts'],
    overstepped: ['src/app.ts'],
    commits: 1,
  },
  {
    name: 'U2: an authorized commit outside writes',
    writes: ['reviews/'],
    committing: true,
    before: {},
    after: {},
    history: ['src/app.ts'],
    touched: ['src/app.ts'],
    overstepped: ['src/app.ts'],
    commits: 0,
  },
  {
    name: 'U3: an authorized commit inside writes',
    writes: ['reviews/'],
    committing: true,
    before: {},
    after: {},
    history: ['reviews/notes.md'],
    touched: ['reviews/notes.md'],
    overstepped: [],
    commits: 0,
  },
  {
    name: 'U4: overlapping tree and history paths',
    writes: ['reviews/'],
    committing: false,
    before: { 'src/app.ts': '1,0' },
    after: { 'src/app.ts': '2,0' },
    history: ['src/b.ts', 'src/app.ts'],
    touched: ['src/app.ts', 'src/b.ts'],
    overstepped: ['src/app.ts', 'src/b.ts'],
    commits: 1,
  },
  {
    name: 'U5: a sibling committing its declared path',
    writes: ['reviews/'],
    committing: false,
    before: {},
    after: {},
    history: ['code-reviews/theirs.md', 'reviews/mine.md'],
    touched: ['reviews/mine.md'],
    overstepped: [],
    commits: 1,
  },
  {
    name: 'U6: a committed protected path with unrestricted writes',
    writes: ['*'],
    committing: true,
    before: {},
    after: {},
    history: ['.pi-crust/config/crust.config.yaml'],
    touched: ['.pi-crust/config/crust.config.yaml'],
    overstepped: ['.pi-crust/config/crust.config.yaml'],
    commits: 0,
  },
]) {
  test(
    [
      `given use-cases/enforce-permissions::enforcePermissions with ${scenario.name}`,
      'when history paths are supplied alongside the snapshots',
      'it should judge the sorted union with the existing ownership and protection rules',
    ].join(', '),
    () => {
      // given
      const cfg = configWith([
        { name: 'reviewer', writes: scenario.writes },
        { name: 'code-reviewer', writes: ['code-reviews/'] },
      ])

      // when
      const actual = enforcePermissions(
        runIn('/repo', cfg),
        agentNamed(cfg, 'reviewer'),
        {
          tree: scenario.before,
          head: 'a'.repeat(40),
          committing: scenario.committing,
        },
        {
          tree: scenario.after,
          head: 'b'.repeat(40),
          history: scenario.history,
        },
        [agentNamed(cfg, 'code-reviewer')],
      )

      // then
      expect(actual.touched).toEqual(scenario.touched)
      expect(actual.overstepped).toEqual(scenario.overstepped)
      expect(actual.committed).toHaveLength(scenario.commits)
      if (scenario.commits === 0) expect(actual.committed).toEqual([])
    },
  )
}
