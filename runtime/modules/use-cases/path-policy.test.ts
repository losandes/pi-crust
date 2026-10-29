import { expect, test } from 'bun:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crustConfigSchema } from '../typedefs/config'
import { renderWarnings } from '../typedefs/warning'
import type { TGoverned, TPathSettings, TRefusal } from './path-policy'
import {
  bashTokens,
  decidePath,
  governToolCall,
  pathsFromInput,
  refusalLine,
  repoRelative,
} from './path-policy'
import { armPolicy, refusalsIn, settingsFor } from './path-policy-run'

const settings = (
  overrides: Partial<TPathSettings> = {},
): TPathSettings => ({
  repoRoot: '/repo',
  dataDir: '.pi-crust/data',
  handoffDir: '',
  protectedFiles: ['.pi-crust/config/', '.env*', '**/.env*'],
  protectedPolicy: { read: 'block', write: 'block' },
  ignoredPolicy: { read: 'warn', write: 'block' },
  ...overrides,
})

const never = () => false

const cases = [
  { intent: 'read' as const, name: 'read' },
  { intent: 'write' as const, name: 'written' },
]

for (const { intent, name } of cases) {
  test(
    [
      'given use-cases/path-policy::decidePath',
      `when a protected path is about to be ${name}`,
      'it should be blocked, because an exposure cannot be undone afterwards',
    ].join(', '),
    () => {
      // given
      const given = settings()

      // when
      const actual = decidePath({
        path: '.env',
        intent,
        settings: given,
        isIgnored: never,
      })

      // then
      expect(actual).toEqual({
        path: '.env',
        intent,
        reason: 'protected',
        verb: 'block',
      })
    },
  )
}

test(
  [
    'given use-cases/path-policy::decidePath',
    'when an ordinary source file is reached for',
    'it should not be governed at all',
  ].join(', '),
  () => {
    // given
    const given = settings()

    // when
    const actual = decidePath({
      path: 'src/server.ts',
      intent: 'write',
      settings: given,
      isIgnored: never,
    })

    // then
    expect(actual.verb).toEqual('allow')
    expect(actual.reason).toEqual('ungoverned')
  },
)

test(
  [
    'given use-cases/path-policy::decidePath',
    'when an env file sits below the repository root',
    'it should still be protected, because `*` does not cross a slash',
  ].join(', '),
  () => {
    /*
     * given — a single star stops at a slash and a double star crosses one,
     * so the shipped list needs both spellings of an env file: one for the
     * repository root, one for every directory below it. An env file turns
     * up wherever a service lives, not only at the top.
     */
    const given = settings()

    // when
    const nested = decidePath({
      path: 'services/api/.env.production',
      intent: 'read',
      settings: given,
      isIgnored: never,
    })
    const root = decidePath({
      path: '.env',
      intent: 'read',
      settings: given,
      isIgnored: never,
    })

    // then
    expect(nested.reason).toEqual('protected')
    expect(root.reason).toEqual('protected')
  },
)

test(
  [
    'given use-cases/path-policy::decidePath',
    'when a gitignored file is read and when one is written',
    'it should warn on the read and block the write',
  ].join(', '),
  () => {
    /*
     * given — reading a generated file is ordinary work; writing one
     * produces work that is not in the repository, so no diff, no review and
     * no commit will ever show it.
     */
    const given = settings()

    // when
    const read = decidePath({
      path: 'dist/bundle.js',
      intent: 'read',
      settings: given,
      isIgnored: () => true,
    })
    const write = decidePath({
      path: 'dist/bundle.js',
      intent: 'write',
      settings: given,
      isIgnored: () => true,
    })

    // then
    expect(read.verb).toEqual('warn')
    expect(write.verb).toEqual('block')
  },
)

test(
  [
    'given use-cases/path-policy::decidePath',
    "when the path is this run's own handoff document under data_dir",
    'it should be ungoverned, even though git ignores it',
  ].join(', '),
  () => {
    /*
     * given — the run's record of itself is gitignored by design, and it is
     * where handoff documents, envelopes, prompts and raw output land. The
     * same exemption `writes:` already makes, for the same reason.
     */
    const given = settings()

    // when
    const actual = decidePath({
      path: '.pi-crust/data/sessions/abc/context_handoff/plan.md',
      intent: 'write',
      settings: given,
      isIgnored: () => true,
    })

    // then
    expect(actual.verb).toEqual('allow')
  },
)

test(
  [
    'given use-cases/path-policy::repoRelative',
    'when a tool call names a file by its absolute path',
    'it should be matched the way the policy spells it, from the root',
  ].join(', '),
  () => {
    // given, when
    const actual = repoRelative('/repo', '/repo/src/server.ts')

    // then
    expect(actual).toEqual('src/server.ts')
  },
)

test(
  [
    'given use-cases/path-policy::pathsFromInput',
    'when the tool is one nobody classified',
    'it should govern nothing, rather than guess at an intent',
  ].join(', '),
  () => {
    // given — a guarantee that is only apparent is worse than none
    const given = { path: '.env' }

    // when
    const actual = pathsFromInput('fetch', given)

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/path-policy::bashTokens',
    'when a shell command names a file',
    'it should offer the token, as the best effort it is',
  ].join(', '),
  () => {
    // given
    const given = 'cat .env | head -2'

    // when
    const actual = bashTokens(given)

    // then
    expect(actual).toContain('.env')
  },
)

/** A repository with a .gitignore, which is what decides ignored membership. */
const aRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-policy-'))
  const git = (...args: readonly string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  writeFileSync(join(dir, '.gitignore'), 'dist/\n.pi-crust/data/\n')
  writeFileSync(join(dir, '.env'), 'SECRET=1\n')

  return dir
}

/**
 * The handler, as the extension calls it: git decides ignored membership, and
 * the settings are the ones a run arms.
 */
const governing = (dir: string) => {
  const cfg = crustConfigSchema.parse({
    defaults: {
      protected_files: ['.pi-crust/config/', '.env*', '**' + '/.env*'],
      data_dir: '.pi-crust/data',
    },
  })
  const resolved = settingsFor(cfg, dir, join(dir, '.pi-crust', 'data', 'sessions', 'test', 'context_handoff'))

  return (toolName: string, input: Record<string, unknown>): TGoverned =>
    governToolCall({
      call: { toolName, input },
      settings: resolved,
      // Membership is git's answer, exactly as the extension asks it.
      isIgnored: (path) =>
        spawnSync('git', ['check-ignore', '--quiet', '--', path], {
          cwd: dir,
        }).status === 0,
    })
}

test(
  [
    'given use-cases/path-policy::governToolCall',
    'when an agent asks to read a protected file',
    'it should refuse the call before it runs, and record why',
  ].join(', '),
  () => {
    /*
     * given — this is the only check in the system that happens BEFORE the
     * call. The post-hoc one cannot see `.env` at all: `snapshotTree` is a
     * diff plus untracked files, so a gitignored path never appears in it.
     */
    const dir = aRepo()
    const govern = governing(dir)

    // when
    const actual = govern('read', { path: join(dir, '.env') })

    // then
    expect(actual.blocked?.reason).toEqual('protected')
    expect(actual.refusals).toEqual([
      {
        tool: 'read',
        path: '.env',
        intent: 'read',
        reason: 'protected',
        verb: 'block',
        bestEffort: false,
      },
    ])
  },
)

test(
  [
    'given use-cases/path-policy::governToolCall',
    'when a shell command names a protected file',
    'it should refuse what it can see, and mark it as the best effort it is',
  ].join(', '),
  () => {
    /*
     * given — `bash` is covered best-effort only. `cat .env` is matched;
     * `grep -r KEY .` and `env > dump` are not, which is why a team that
     * must not leak a path should not give that Activity bash at all.
     */
    const dir = aRepo()
    const govern = governing(dir)

    // when
    const actual = govern('bash', { command: 'cat .env' })

    // then
    expect(actual.blocked?.path).toEqual('.env')
    expect(actual.refusals[0]?.bestEffort).toEqual(true)
  },
)

test(
  [
    'given use-cases/path-policy-run::armPolicy',
    'when a call is armed',
    'it should write the policy where the agent’s own record already lives',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    const cfg = crustConfigSchema.parse({ defaults: { data_dir: '.pi-crust/data' } })

    // when
    const actual = armPolicy({
      cfg,
      repoRoot: dir,
      handoffDir: join(dir, '.pi-crust', 'data', 'sessions', 'run_01', 'context_handoff'),
      agentDir: join(dir, 'agent'),
      activityRunId: 'run_01_build',
    })

    // then
    expect(actual.env.CRUST_PATH_POLICY).toEqual(
      join(dir, 'agent', 'path_policy_run_01_build.json'),
    )
    expect(
      JSON.parse(readFileSync(actual.env.CRUST_PATH_POLICY ?? '', 'utf8')),
    ).toMatchObject({ dataDir: '.pi-crust/data' })
    expect(refusalsIn(actual.refusals)).toEqual([])
  },
)

test(
  [
    'given typedefs/config::crustConfigSchema',
    'when a config declares no path policy at all',
    'it should load the shipped defaults, which fail closed',
  ].join(', '),
  () => {
    // given, when
    const actual = crustConfigSchema.parse({})

    // then
    expect(actual.defaults.protected).toEqual({
      read: 'block',
      write: 'block',
    })
    expect(actual.defaults.ignored).toEqual({ read: 'warn', write: 'block' })
  },
)

test(
  [
    'given typedefs/config::crustConfigSchema',
    'when a config asks for a verb that is not one of the four',
    'it should refuse at load and name the ones that exist',
  ].join(', '),
  () => {
    // given — `revert` is the one this replaced, and it is not coming back
    const given = { defaults: { protected: { read: 'revert' } } }

    // when
    const actual = crustConfigSchema.safeParse(given)

    // then
    expect(actual.success).toEqual(false)
    expect(actual.error?.issues[0]?.message).toEqual(
      'revert is not a path policy. Use one of: block, stop, warn, allow.',
    )
  },
)

test(
  [
    'given use-cases/path-policy::governToolCall',
    'when an agent writes a gitignored file, and when it reads one',
    'it should block the write, let the read happen, and record both',
  ].join(', '),
  () => {
    /*
     * given — reading a generated file is ordinary work. Writing one
     * produces work that is not in the repository, so no diff, no review and
     * no commit will ever show it.
     */
    const dir = aRepo()
    const govern = governing(dir)

    // when
    const write = govern('write', { path: 'dist/bundle.js', content: 'x' })
    const read = govern('read', { path: 'dist/bundle.js' })

    // then
    expect(write.blocked?.reason).toEqual('ignored')
    expect(read.blocked).toBeUndefined()
    expect(read.refusals.map((one) => one.verb)).toEqual(['warn'])
  },
)

test(
  [
    'given use-cases/path-policy::governToolCall',
    'when an agent writes its own handoff document under data_dir',
    'it should be left alone, because that is where its work belongs',
  ].join(', '),
  () => {
    /*
     * given — the run's record of itself is gitignored by design, and it is
     * where handoff documents, envelopes, prompts and raw output land. The
     * same exemption `writes:` already makes, for the same reason.
     */
    const dir = aRepo()
    const govern = governing(dir)

    // when
    const actual = govern('write', {
      path: '.pi-crust/data/sessions/abc/context_handoff/plan.md',
      content: '# plan',
    })

    // then
    expect(actual.blocked).toBeUndefined()
    expect(actual.refusals).toEqual([])
  },
)

test(
  [
    'given use-cases/path-policy::governToolCall',
    'when an agent writes an ordinary source file',
    'it should let the call through and record nothing',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    const govern = governing(dir)

    // when
    const actual = govern('write', { path: 'src/server.ts', content: 'x' })

    // then
    expect(actual.blocked).toBeUndefined()
    expect(actual.refusals).toEqual([])
  },
)

test(
  [
    'given use-cases/path-policy-run::refusalsIn',
    'when the extension recorded a governed call and then a torn line',
    'it should carry the whole record and drop what it cannot read',
  ].join(', '),
  () => {
    /*
     * given — the record of a refusal is worth less than the refusal, which
     * already happened inside the harness. A half-written line must not fail
     * an Activity Run that was otherwise fine.
     */
    const dir = mkdtempSync(join(tmpdir(), 'crust-refusals-'))
    const path = join(dir, 'path_refusals.jsonl')
    writeFileSync(
      path,
      `${JSON.stringify({
        tool: 'read',
        path: '.env',
        intent: 'read',
        reason: 'protected',
        verb: 'block',
        bestEffort: false,
      })}\n{"tool":"read",\n`,
    )

    // when
    const actual = refusalsIn(path)

    // then
    expect(actual).toHaveLength(1)
    expect(refusalLine(actual[0] as TRefusal)).toEqual(
      'block read of .env by read',
    )
  },
)

test(
  [
    'given typedefs/warning::renderWarnings',
    'when the path policy refused a call',
    'it should reach the same report every other warning does',
  ].join(', '),
  () => {
    // given
    const given = [
      {
        kind: 'refusal' as const,
        activities: ['build'],
        activityRunIds: ['run_01_build'],
        stage: 'implement',
        paths: ['block read of .env by read'],
        note: 'build reached 1 governed path(s)',
      },
    ]

    // when
    const actual = renderWarnings(given).join('\n')

    // then
    expect(actual).toContain('block read of .env by read')
    expect(actual).toContain('A blocked call never ran')
  },
)

test(
  [
    'given use-cases/path-policy::decidePath',
    'when --handoff relocated the directory outside data_dir, and it is gitignored',
    'it should be ungoverned, the same exemption data_dir already gets',
  ].join(', '),
  () => {
    /*
     * given — a relocated handoff directory may still be gitignored, and
     * without this exemption `ignored.write` would refuse an agent's own
     * document.
     */
    const dir = aRepo()
    writeFileSync(join(dir, '.gitignore'), 'dist/\n.pi-crust/data/\nspecs/\n')
    const cfg = crustConfigSchema.parse({
      defaults: { data_dir: '.pi-crust/data' },
    })
    const handoffDir = join(dir, 'specs', 'a1b2c3d4')
    const resolved = settingsFor(cfg, dir, handoffDir)
    const isIgnored = (path: string) =>
      spawnSync('git', ['check-ignore', '--quiet', '--', path], {
        cwd: dir,
      }).status === 0

    // when
    const actual = decidePath({
      path: join(handoffDir, 'plan.md'),
      intent: 'write',
      settings: resolved,
      isIgnored,
    })

    // then
    expect(actual.reason).toEqual('ungoverned')
    expect(actual.verb).toEqual('allow')
  },
)

test(
  [
    'given use-cases/path-policy::decidePath',
    'when the same gitignored path is OUTSIDE the handoff directory',
    'it should still be governed, which is what proves the exemption is not a blanket allow',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    writeFileSync(join(dir, '.gitignore'), 'dist/\n.pi-crust/data/\nspecs/\n')
    const cfg = crustConfigSchema.parse({
      defaults: { data_dir: '.pi-crust/data' },
    })
    const handoffDir = join(dir, 'specs', 'a1b2c3d4')
    const resolved = settingsFor(cfg, dir, handoffDir)
    const isIgnored = (path: string) =>
      spawnSync('git', ['check-ignore', '--quiet', '--', path], {
        cwd: dir,
      }).status === 0

    // when — a sibling run's directory, not this run's own
    const actual = decidePath({
      path: join(dir, 'specs', 'someone-elses-run', 'plan.md'),
      intent: 'write',
      settings: resolved,
      isIgnored,
    })

    // then
    expect(actual.reason).toEqual('ignored')
    expect(actual.verb).toEqual(resolved.ignoredPolicy.write)
  },
)

test(
  [
    'given use-cases/path-policy-run::settingsFor',
    'when data_dir resolves OUTSIDE the repository, a pooled store (issue #24, 1.9.2)',
    'it should leave an agent writing into its own session directory ungoverned, exactly as it is when data_dir sits inside the repository',
  ].join(', '),
  () => {
    // given — a pooled store the repository does not contain
    const dir = aRepo()
    const pooledStore = mkdtempSync(join(tmpdir(), 'crust-policy-pooled-'))
    const cfg = crustConfigSchema.parse({
      defaults: {
        protected_files: ['.pi-crust/config/'],
        data_dir: pooledStore,
      },
    })
    const handoffDir = join(pooledStore, 'sessions', 'run_01', 'context_handoff')
    const resolved = settingsFor(cfg, dir, handoffDir)

    // when — an agent writes into this run's own session directory, named
    // the way a real tool call would: absolute, since it falls outside the
    // repository the call is otherwise addressed relative to
    const actual = governToolCall({
      call: {
        toolName: 'write',
        input: {
          path: join(pooledStore, 'sessions', 'run_01', 'agent_map.json'),
          content: '{}',
        },
      },
      settings: resolved,
      isIgnored: () => false,
    })

    // then
    expect(actual.blocked).toBeUndefined()
    expect(actual.refusals).toEqual([])
  },
)
