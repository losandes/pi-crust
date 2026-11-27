import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { main } from './cli'
import { RECIPE_DOCS, type TScriptRun } from './domains/cli'
import { createTracer } from './domains/trace'
import { SKIP_INTEGRATION } from './testing/integration'

const PACKAGE = resolve(import.meta.dir, '..')
const CLI = join(PACKAGE, 'runtime/cli.ts')

// Allow subprocess startup and task retries under parallel suite load.
const INTEGRATION_TIMEOUT_MS = 20_000

for (const mode of ['own', 'other', 'invalid', 'refusal'] as const) {
  test(
    [
      `given ${mode} CLI dependencies`,
      `when invoked`,
      `it should order resolution and forward status`,
    ].join(', '),
    () => {
      // given
      let order: string[] = []
      let calls: (TScriptRun &
        Readonly<{ env: Readonly<Record<string, string | undefined>> }>)[] = []
      let messages: string[] = []
      const deps: Parameters<typeof main>[0] = {
        env: { VALUE: 'shell' },
        cwd: '/repo/sub',
        packageRoot: '/pkg',
        envFiles: () => {
          order = [...order, 'env']
          return { VALUE: 'file', FILE: 'yes' }
        },
        crustHome: () => {
          order = [...order, 'home']
          return mode === 'other'
            ? { kind: 'other', cli: '/other/runtime/cli.ts' }
            : mode === 'invalid'
              ? { kind: 'invalid', home: '/bad' }
              : { kind: 'own' }
        },
        toplevel: () => {
          order = [...order, 'git']
          return '/repo'
        },
        run: (run) => {
          order = [...order, 'run']
          calls = [...calls, run]
          return 3
        },
        write: (text) => (messages = [...messages, text]),
      }
      const argv = mode === 'refusal' ? ['approve'] : ['help', 'two words']
      // when
      const result = main(deps)(argv)
      // then
      expect(result).toBe(['invalid', 'refusal'].includes(mode) ? 2 : 3)
      expect(order).toEqual(
        mode === 'invalid'
          ? ['env', 'home']
          : mode === 'other'
            ? ['env', 'home', 'run']
            : mode === 'refusal'
              ? ['env', 'home', 'git']
              : ['env', 'home', 'git', 'run'],
      )
      if (mode === 'invalid')
        expect(messages).toEqual([
          'crust: CRUST_HOME names /bad, which holds no pi-crust runtime: /bad/runtime/cli.ts does not exist.\n',
        ])
      if (mode === 'refusal') expect(messages[0]).toContain('missing <run-id>')
      expect(calls).toHaveLength(['invalid', 'refusal'].includes(mode) ? 0 : 1)
      if (calls.length)
        expect(calls[0]).toEqual({
          script:
            mode === 'other'
              ? '/other/runtime/cli.ts'
              : '/pkg/runtime/commands/help.ts',
          args:
            mode === 'other'
              ? argv
              : ['--config', 'pi-crust.toml', ...argv.slice(1)],
          cwd: mode === 'other' ? '/repo/sub' : '/repo',
          env: { VALUE: 'shell', FILE: 'yes' },
        })
    },
  )
}

const fixture = () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'crust-cli-')))
  const root = join(scratch, 'repo')
  const home = join(scratch, 'home')
  const machine = join(scratch, 'machine')
  for (const dir of [root, home, machine]) mkdirSync(dir)
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    CRUST_MACHINE_CONFIG: machine,
    PI_PATH: join(scratch, 'no-pi'),
  }
  const invoke = (
    args: readonly string[],
    cwd = root,
    extra: Readonly<Record<string, string>> = {},
  ) =>
    spawnSync('bun', [CLI, ...args], {
      cwd,
      env: { ...env, ...extra },
      encoding: 'utf8',
    })
  const git = () =>
    expect(spawnSync('git', ['init', '-q'], { cwd: root, env }).status).toBe(0)
  return {
    scratch,
    root,
    home,
    machine,
    env,
    invoke,
    git,
    [Symbol.dispose]: () => rmSync(scratch, { recursive: true, force: true }),
  }
}

for (const repository of [false, true]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given ${repository ? 'a fresh Git repository' : 'a directory outside Git'}`,
      'when crust --version runs',
      'it should print the package version without creating files',
    ].join(', '),
    () => {
      // given
      using f = fixture()
      if (repository) f.git()
      const { version } = JSON.parse(
        readFileSync(join(PACKAGE, 'package.json'), 'utf8'),
      )
      // when
      const result = f.invoke(['--version'])
      // then
      expect(result.status).toBe(0)
      expect(result.stdout).toBe(`${version}\n`)
      expect(result.stderr).toBe('')
      expect(readdirSync(f.root)).toEqual(repository ? ['.git'] : [])
      expect(existsSync(join(f.home, '.pi-crust/data'))).toBe(false)
    },
    INTEGRATION_TIMEOUT_MS,
  )
}

for (const argv of [
  [],
  ['default'],
  ['help', 'run'],
  ['help', 'two words'],
  ['frobnicate'],
  ['approve'],
  ['run', 'anything', '--activities', 'scout'],
  ['ship', 'do something'],
  ['sessions'],
] as const) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given outside Git`,
      `when crust ${argv.join(' ')}`,
      `it should list help or refuse without files`,
    ].join(', '),
    () => {
      // given
      using f = fixture()
      // when
      const result = f.invoke(argv)
      // then
      const allowed =
        argv.length === 0 ||
        argv[0] === 'default' ||
        (argv[0] === 'help' && argv[1] === 'run')
      expect(result.status).toBe(allowed ? 0 : 2)
      if (argv.length === 0 || argv[0] === 'default')
        for (const doc of RECIPE_DOCS)
          expect(result.stdout).toContain(doc.summary)
      if (argv[0] === 'help' && argv[1] === 'two words')
        expect(result.stderr).toContain('"two words"')
      if (argv[0] === 'frobnicate') {
        expect(result.stderr).toContain('frobnicate')
        expect(result.stderr).toContain('crust help')
      }
      if (argv[0] === 'approve') {
        expect(result.stderr).toContain('run-id')
        expect(result.stderr).toContain('usage:')
      }
      if (argv[0] === 'ship') expect(result.stderr).toContain('crust ship:')
      if (['run', 'ship', 'sessions'].includes(argv[0] ?? '')) {
        expect(result.stderr).toContain('git init')
        expect(result.stderr).toContain('crust init')
      }
      expect(readdirSync(f.root)).toEqual([])
    },
    INTEGRATION_TIMEOUT_MS,
  )
}

for (const name of ['gh-issue', 'ship', 'ship-plan', 'ship-outcome']) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given ${name} inside a fresh Git repository`,
      'when help or invalid input is requested',
      'it should report usage or conflicts without starting a run',
    ].join(', '),
    () => {
      // given
      using f = fixture()
      f.git()
      // when
      const missing = f.invoke([name])
      const conflict = f.invoke([name, 'x', '--lifecycle', 'bugfix'])
      const activities = f.invoke([name, 'x', '--activities', 'plan,build'])
      const help = f.invoke(['help', name])
      // then
      expect(missing.status).toBe(2)
      expect(missing.stderr).toContain('a prompt is required')
      expect(missing.stderr).toContain(`usage: crust ${name} "`)
      expect(conflict.status).toBe(2)
      expect(conflict.stderr).toContain('conflicts with this command')
      expect(activities.status).toBe(2)
      expect(activities.stderr).toContain('cannot both be given')
      expect(help.status).toBe(0)
      expect(help.stdout).toContain(
        `crust ${name} "<prompt or path/to/prompt.md>" [options]`,
      )
      expect(readdirSync(f.root)).toEqual(['.git'])
      expect(existsSync(join(f.home, '.pi-crust/data'))).toBe(false)
    },
    INTEGRATION_TIMEOUT_MS,
  )
}

const lifecycle = (name: string) =>
  `[lifecycles.${name}]\nstages = [{ name = "look", serial = ["scout"] }]\n`

test.skipIf(SKIP_INTEGRATION)(
  [
    'given repository and machine catalogues',
    'when listing from a child or outside Git',
    'it should select the correct layers',
  ].join(', '),
  () => {
    // given
    using f = fixture()
    f.git()
    writeFileSync(join(f.root, 'pi-crust.toml'), lifecycle('repo_probe'))
    writeFileSync(
      join(f.machine, 'crust.lifecycles.toml'),
      lifecycle('machine_probe'),
    )
    const child = join(f.root, 'a/b')
    mkdirSync(child, { recursive: true })
    const outside = join(f.scratch, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'pi-crust.toml'), lifecycle('stray_probe'))
    // when
    const root = f.invoke(['list'])
    const nested = f.invoke(['list'], child)
    const external = f.invoke(['list'], outside)
    // then
    expect(root.status).toBe(0)
    expect(nested.status).toBe(0)
    expect(nested.stdout).toBe(root.stdout)
    expect(root.stdout).toContain('repo_probe')
    expect(external.status).toBe(0)
    expect(external.stdout).toContain('machine_probe')
    expect(external.stdout).not.toContain('stray_probe')
  },
  INTEGRATION_TIMEOUT_MS,
)

for (const repository of [true, false]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given fresh repository ${repository}`,
      `when init starts in a child directory`,
      `it should stamp the right root`,
    ].join(', '),
    () => {
      // given
      using f = fixture()
      if (repository) f.git()
      const cwd = repository ? join(f.root, 'child') : f.root
      mkdirSync(cwd, { recursive: true })
      // when
      const result = f.invoke(['init'], cwd)
      // then
      expect(result.status).toBe(0)
      expect(existsSync(join(f.root, 'pi-crust.toml'))).toBe(true)
      expect(existsSync(join(f.root, '.env.pi-crust.example'))).toBe(true)
      expect(readFileSync(join(f.root, '.gitignore'), 'utf8')).toContain(
        '.pi-crust/data/',
      )
      if (!repository)
        expect(readdirSync(f.root).toSorted()).toEqual([
          '.env.pi-crust.example',
          '.gitignore',
          'pi-crust.toml',
        ])
      expect(result.stdout).toContain('crust demo')
      expect(result.stdout).toContain('crust sessions')
      expect(result.stdout).toContain('crust observe')
      expect(result.stdout).toContain('pi-crust.toml')
      expect(result.stdout).toContain('.env.pi-crust.example')
      if (repository) expect(readdirSync(cwd)).toEqual([])
    },
    INTEGRATION_TIMEOUT_MS,
  )
}

for (const argv of [['init'], ['init', '--refresh'], ['update']]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      'given an unconfigured Git repository',
      `when crust ${argv.join(' ')}`,
      'it should create the three setup files',
    ].join(', '),
    () => {
      // given
      using f = fixture()
      f.git()
      // when
      const result = f.invoke(argv)
      // then
      expect(result.status).toBe(0)
      expect(
        readdirSync(f.root)
          .filter((name) => name !== '.git')
          .toSorted(),
      ).toEqual(['.env.pi-crust.example', '.gitignore', 'pi-crust.toml'])
    },
    INTEGRATION_TIMEOUT_MS,
  )
}

for (const [kind, argv] of [
  ['team', ['init']],
  ['team', ['init', '--refresh']],
  ['earlier', ['init']],
  ['earlier', ['update']],
] as const) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given ${kind} recipes and existing package records`,
      `when crust ${argv.join(' ')}`,
      'it should preserve their bytes',
    ].join(', '),
    () => {
      // given
      using f = fixture()
      f.git()
      const recipes =
        kind === 'team'
          ? 'test:\n    echo team-owned\r\n'
          : 'set positional-arguments\n\ncrust *ARGS:\n    @bun "$(cat .pi-crust/data/pi-crust-home)/runtime/cli.ts" {{ARGS}}\n'
      const files = [
        [join(f.root, 'justfile'), recipes],
        [join(f.home, '.pi-crust/pi-crust-home'), '/previous/package\n'],
        [join(f.root, '.pi-crust/data/pi-crust-home'), '/gone/stale/package\n'],
      ] as const
      mkdirSync(join(f.home, '.pi-crust'), { recursive: true })
      mkdirSync(join(f.root, '.pi-crust/data'), { recursive: true })
      for (const [path, bytes] of files) writeFileSync(path, bytes)
      // when
      const result = f.invoke(argv)
      // then
      expect(result.status).toBe(0)
      for (const [path, bytes] of files)
        expect(readFileSync(path, 'utf8')).toBe(bytes)
    },
    INTEGRATION_TIMEOUT_MS,
  )
}

for (const local of [true, false]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given ${local ? 'repository' : 'machine'} history`,
      `when refreshed`,
      `it should preserve configuration sessions and documents`,
    ].join(', '),
    () => {
      // given
      using f = fixture()
      f.git()
      const config = local
        ? '[defaults]\ndata_dir = "{primary_worktree}/.pi-crust/data"\n# edited\n'
        : '# team owned\n'
      writeFileSync(join(f.root, 'pi-crust.toml'), config)
      const data = local
        ? join(f.root, '.pi-crust/data')
        : join(f.home, '.pi-crust/data')
      const tracer = createTracer(
        join(data, 'crust.db'),
        join(data, 'events.jsonl'),
      )
      const ids = local ? ['one', 'two'] : ['one', 'two', 'three']
      for (const id of ids) {
        tracer.sessionStart(id, 'tester', 'test')
        tracer.sessionRequest(id, `request ${id}`)
        mkdirSync(join(data, 'sessions', id), { recursive: true })
        writeFileSync(join(data, 'sessions', id, 'notes.md'), `valuable ${id}`)
      }
      tracer.close()
      const before = f.invoke(['sessions'])
      // when
      const refreshed = f.invoke(local ? ['update'] : ['init', '--refresh'])
      const after = f.invoke(['sessions'])
      // then
      expect(before.status).toBe(0)
      expect(refreshed.status).toBe(0)
      expect(after.status).toBe(0)
      expect(after.stdout).toBe(before.stdout)
      expect(after.stdout.trim().split('\n')).toHaveLength(ids.length)
      expect(readFileSync(join(f.root, 'pi-crust.toml'), 'utf8')).toBe(config)
      for (const id of ids)
        expect(
          readFileSync(join(data, 'sessions', id, 'notes.md'), 'utf8'),
        ).toBe(`valuable ${id}`)
    },
    INTEGRATION_TIMEOUT_MS,
  )
}

for (const mode of ['env', 'local', 'shell'] as const) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given ${mode} port settings`,
      `when config starts beneath the files`,
      `it should respect precedence`,
    ].join(', '),
    () => {
      // given
      using f = fixture()
      writeFileSync(join(f.root, '.env'), 'CRUST_BE_PORT=4700\n')
      if (mode !== 'env')
        writeFileSync(join(f.root, '.env.local'), 'CRUST_BE_PORT=4800\n')
      const cwd = join(f.root, 'child')
      mkdirSync(cwd)
      // when
      const result = f.invoke(
        ['config'],
        cwd,
        mode === 'shell' ? { CRUST_BE_PORT: '4900' } : {},
      )
      // then
      expect(result.status).toBe(0)
      expect(result.stdout).toContain(
        mode === 'shell' ? '4900' : mode === 'local' ? '4800' : '4700',
      )
      expect(result.stdout).toContain('env')
    },
    INTEGRATION_TIMEOUT_MS,
  )
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given another checkout and invalid and self overrides',
    'when invoked',
    'it should delegate exactly once or refuse',
  ].join(', '),
  () => {
    // given
    using f = fixture()
    const other = join(f.scratch, 'other')
    mkdirSync(join(other, 'runtime'), { recursive: true })
    writeFileSync(
      join(other, 'runtime/cli.ts'),
      'console.log("marker", JSON.stringify(process.argv.slice(2))); process.exit(5)',
    )
    // when
    const delegated = f.invoke(['help', 'x'], f.root, { CRUST_HOME: other })
    const own = f.invoke(['help'])
    const self = f.invoke(['list'], f.root, { CRUST_HOME: PACKAGE })
    const invalid = f.invoke(['list'], f.root, { CRUST_HOME: f.scratch })
    // then
    expect(delegated.status).toBe(5)
    expect(delegated.stdout).toContain('marker ["help","x"]')
    expect(own.status).toBe(0)
    expect(own.stdout).toContain('set pi-crust up in this repository')
    expect(self.status).toBe(0)
    expect(self.stdout).toBe(f.invoke(['list']).stdout)
    expect(invalid.status).toBe(2)
    expect(invalid.stderr).toContain('CRUST_HOME')
    expect(invalid.stderr).toContain(f.scratch)
    expect(invalid.stdout).toBe('')
  },
  INTEGRATION_TIMEOUT_MS,
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a waiting trace',
    'when reported through crust',
    'it should preserve exit status three',
  ].join(', '),
  () => {
    // given
    using f = fixture()
    f.git()
    const data = join(f.home, '.pi-crust/data')
    const tracer = createTracer(
      join(data, 'crust.db'),
      join(data, 'events.jsonl'),
    )
    tracer.sessionStart('waiting', 'tester', 'test')
    tracer.sessionRequest('waiting', 'request')
    tracer.sessionWaiting('waiting')
    tracer.close()
    // when
    const result = f.invoke(['report', 'waiting'])
    // then
    expect(result.status).toBe(3)
    expect(result.stdout).toContain('waiting')
  },
  INTEGRATION_TIMEOUT_MS,
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given the bin entry',
    'when linked into scratch directories',
    'it should run help outside the clone',
  ].join(', '),
  () => {
    // given
    using f = fixture()
    const install = join(f.scratch, 'bun-install')
    mkdirSync(install)
    const env = { PATH: process.env.PATH, HOME: f.home, BUN_INSTALL: install }
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE, 'package.json'), 'utf8'),
    )
    // when
    const linked = spawnSync('bun', ['link'], {
      cwd: PACKAGE,
      env,
      encoding: 'utf8',
    })
    const bin = join(install, 'bin/crust')
    // then
    expect(manifest.bin.crust).toBe('runtime/cli.ts')
    expect(readFileSync(CLI, 'utf8').split('\n')[0]).toBe('#!/usr/bin/env bun')
    expect(statSync(CLI).mode & 0o111).not.toBe(0)
    expect(linked.status).toBe(0)
    expect(realpathSync(bin)).toBe(realpathSync(CLI))
    const result = spawnSync('crust', ['help'], {
      cwd: f.root,
      env: {
        ...f.env,
        BUN_INSTALL: install,
        PATH: `${install}/bin:${process.env.PATH}`,
      },
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('set pi-crust up in this repository')
  },
  INTEGRATION_TIMEOUT_MS,
)
