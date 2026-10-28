import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTracer } from '../data/trace-db'
import { crustConfigSchema } from '../typedefs/config'
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
      observability: { db: join(workspace, 'crust.db') },
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

test(
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

test(
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

test(
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
