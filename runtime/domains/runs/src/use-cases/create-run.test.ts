import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activityRunParams, crustConfigSchema } from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { createTracer } from '../../../trace'
import { createRun } from './create-run'

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** A run, stamped by creating `.pi-crust/` where `createRun` is meant to find it. */
const aRun = (workspace: string) => {
  const tracer = createTracer(
    join(workspace, 'crust.db'),
    join(workspace, 'events.jsonl'),
  )
  mkdirSync(join(workspace, '.pi-crust'), { recursive: true })

  return createRun({
    cfg: crustConfigSchema.parse({
      defaults: { data_dir: join(workspace, '.pi-crust', 'data') },
      observability: {},
      agents: [],
    }),
    runId: 'aaaa1111',
    tracer,
    engineer: 'tester',
  })
}

/** `repoRoot()`/`vcsRoot()` both read `process.cwd()`, so tests chdir there. */
const inDir = <TResult>(dir: string, body: () => TResult): TResult => {
  const was = process.cwd()
  process.chdir(dir)
  try {
    return body()
  } finally {
    process.chdir(was)
  }
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/create-run::createRun',
    'when the workspace is itself the VCS root',
    'it should carry repoRoot and vcsRoot equal, which is section 1.6.2\u2019s unchanged flat case',
  ].join(', '),
  () => {
    // given — a workspace that is also a git repository, with no larger tree above it
    const dir = realpathSync(
      mkdtempSync(join(tmpdir(), 'crust-create-run-flat-')),
    )
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'config', 'user.email', 'tester@example.com')
    git(dir, 'config', 'user.name', 'tester')

    // when
    const run = inDir(dir, () => aRun(dir))

    // then
    expect(run.repoRoot).toEqual(dir)
    expect(run.vcsRoot).toEqual(dir)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/create-run::createRun',
    'when the workspace is one package nested inside a larger git repository',
    'it should carry vcsRoot as the repository toplevel, ABOVE repoRoot \u2014 the layout specs/todos/FIX-WORKSPACE-AND-VCS-ROOTS.md fixes',
  ].join(', '),
  () => {
    // given — the real shape of the defect: `.pi-crust/` lives in `_newstack`,
    // a subdirectory of the git repository rather than its toplevel
    const vcsRootDir = realpathSync(
      mkdtempSync(join(tmpdir(), 'crust-create-run-nested-')),
    )
    git(vcsRootDir, 'init', '-q', '-b', 'main')
    git(vcsRootDir, 'config', 'user.email', 'tester@example.com')
    git(vcsRootDir, 'config', 'user.name', 'tester')
    const workspace = join(vcsRootDir, '_newstack')
    mkdirSync(workspace, { recursive: true })

    // when
    const run = inDir(workspace, () => aRun(workspace))

    // then — repoRoot (where configuration resolves) is unmoved by this fix;
    // vcsRoot (where git's own output is relative to) is the toplevel above it
    expect(run.repoRoot).toEqual(workspace)
    expect(run.vcsRoot).toEqual(vcsRootDir)
    expect(run.vcsRoot).not.toEqual(run.repoRoot)
  },
)

test(
  [
    'given use-cases/create-run::createRun',
    'when the workspace is not inside a git repository at all',
    'it should fall back to vcsRoot equal to repoRoot, covering 1.1.2 and 1.6.4',
  ].join(', '),
  () => {
    // given — a stamped workspace with no `git init` anywhere above it
    const dir = realpathSync(
      mkdtempSync(join(tmpdir(), 'crust-create-run-no-git-')),
    )

    // when
    const run = inDir(dir, () => aRun(dir))

    // then
    expect(run.vcsRoot).toEqual(run.repoRoot)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/create-run::createRun',
    'when the VCS root is read after the run was created, from a different cwd',
    'it should keep the value resolved at creation \u2014 1.1.3: resolved once, not re-invoked by a consumer',
  ].join(', '),
  () => {
    // given — a run created inside the repository
    const vcsRootDir = realpathSync(
      mkdtempSync(join(tmpdir(), 'crust-create-run-fixed-')),
    )
    git(vcsRootDir, 'init', '-q', '-b', 'main')
    git(vcsRootDir, 'config', 'user.email', 'tester@example.com')
    git(vcsRootDir, 'config', 'user.name', 'tester')
    const workspace = join(vcsRootDir, '_newstack')
    mkdirSync(workspace, { recursive: true })
    const run = inDir(workspace, () => aRun(workspace))

    // when — the process cwd moves elsewhere after the run exists; nothing
    // in TRun re-invokes `git rev-parse --show-toplevel` to notice
    const elsewhere = mkdtempSync(join(tmpdir(), 'crust-create-run-elsewhere-'))
    const was = process.cwd()
    process.chdir(elsewhere)
    try {
      // then — still the value captured at creation
      expect(run.vcsRoot).toEqual(vcsRootDir)
    } finally {
      process.chdir(was)
    }
  },
)

test(
  [
    'given use-cases/create-run::createRun',
    'when an activityRun is recorded, updated, usage is added, and an agent is saved',
    'it should fold every mutation into the closures it returns, and persist the agent map',
  ].join(', '),
  () => {
    // given
    const dir = realpathSync(
      mkdtempSync(join(tmpdir(), 'crust-create-run-state-')),
    )
    const run = inDir(dir, () => aRun(dir))
    const params = activityRunParams({
      name: 'build',
      kind: 'code',
      owner: 'quality',
      description: 'exercise the run closures',
    })
    const activityRun = {
      activity_run_id: 'build-1',
      run_id: run.runId,
      seq: run.nextSeq(),
      params,
      status: 'running',
      started_at: new Date().toISOString(),
    } as unknown as ReturnType<typeof run.activityRuns>[number]

    // when
    run.recordActivityRun(activityRun)
    const updated = run.updateActivityRun('build-1', { status: 'success' })
    run.addUsage(10, 0.5)
    run.saveAgentMap('technical-architect', {
      sessionId: 'session-1',
    } as unknown as Parameters<typeof run.saveAgentMap>[1])

    // then
    expect(run.activityRuns()).toHaveLength(1)
    expect(updated.status).toEqual('success')
    expect(run.tokens()).toEqual(10)
    expect(run.cost()).toEqual(0.5)
    expect(run.agentMap()['technical-architect']).toEqual({
      sessionId: 'session-1',
    } as unknown as ReturnType<typeof run.agentMap>['technical-architect'])
  },
)

test(
  [
    'given use-cases/create-run::createRun',
    'when updateActivityRun is asked for an id that was never recorded',
    'it should throw naming the id, rather than silently doing nothing',
  ].join(', '),
  () => {
    // given
    const dir = realpathSync(
      mkdtempSync(join(tmpdir(), 'crust-create-run-missing-')),
    )
    const run = inDir(dir, () => aRun(dir))

    // when, then
    expect(() =>
      run.updateActivityRun('does-not-exist', { status: 'success' }),
    ).toThrow(/no such activityRun on this run: does-not-exist/)
  },
)

test(
  [
    'given use-cases/create-run::createRun',
    'when the run is created with an explicit handoffDir and a resume set',
    'it should use the given handoff directory and carry the resume set through',
  ].join(', '),
  () => {
    // given
    const workspace = realpathSync(
      mkdtempSync(join(tmpdir(), 'crust-create-run-handoff-')),
    )
    mkdirSync(join(workspace, '.pi-crust'), { recursive: true })
    const handoffDir = mkdtempSync(
      join(tmpdir(), 'crust-create-run-handoff-dir-'),
    )
    const tracer = createTracer(
      join(workspace, 'crust.db'),
      join(workspace, 'events.jsonl'),
    )

    // when
    const run = inDir(workspace, () =>
      createRun({
        cfg: crustConfigSchema.parse({
          defaults: { data_dir: join(workspace, '.pi-crust', 'data') },
          observability: {},
          agents: [],
        }),
        runId: 'bbbb2222',
        tracer,
        engineer: 'tester',
        resume: new Set(['build']),
        handoffDir,
      }),
    )

    // then
    expect(run.contextHandoffDir).toEqual(handoffDir)
    expect(run.resume.has('build')).toBe(true)
  },
)

test(
  [
    'given use-cases/create-run::createRun',
    'when claimResume is called for a name already in the resume set',
    'it should answer true once, false after, and never mutate run.resume',
  ].join(', '),
  () => {
    // given
    const workspace = realpathSync(
      mkdtempSync(join(tmpdir(), 'crust-create-run-')),
    )
    const tracer = createTracer(
      join(workspace, 'crust.db'),
      join(workspace, 'events.jsonl'),
    )
    mkdirSync(join(workspace, '.pi-crust'), { recursive: true })
    const run = inDir(workspace, () =>
      createRun({
        cfg: crustConfigSchema.parse({
          defaults: { data_dir: join(workspace, '.pi-crust', 'data') },
          observability: {},
          agents: [],
        }),
        runId: 'cccc3333',
        tracer,
        engineer: 'tester',
        resume: new Set(['build']),
      }),
    )

    // when, then — the one credit this name has is spent on its first claim
    expect(run.claimResume('build')).toBe(true)
    expect(run.claimResume('build')).toBe(false)
    expect(run.claimResume('build')).toBe(false)

    // a name never in the resume set has no credit to spend
    expect(run.claimResume('test')).toBe(false)

    // `run.resume` still answers the static question every other reader asks
    expect(run.resume.has('build')).toBe(true)
    expect(run.resume).toEqual(new Set(['build']))
  },
)
