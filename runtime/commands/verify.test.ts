import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EXIT } from '../lib/contracts'
import { SKIP_INTEGRATION } from '../testing/integration'
import { main } from './verify'

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

const inDir = async <T>(dir: string, body: () => Promise<T>): Promise<T> => {
  const previous = process.cwd()
  process.chdir(dir)
  try {
    return await body()
  } finally {
    process.chdir(previous)
  }
}

const capture =
  (stream: Pick<typeof process.stdout, 'write'>) =>
  async (body: () => Promise<number>) => {
    const original = stream.write
    let printed = ''
    // biome-ignore lint/plugin/no-object-mutation: capture terminal output until the asynchronous command settles
    stream.write = ((chunk: string | Uint8Array) => {
      printed += chunk.toString()
      return true
    }) as typeof stream.write
    try {
      return { result: await body(), printed }
    } finally {
      // biome-ignore lint/plugin/no-object-mutation: restore the terminal stream
      stream.write = original
    }
  }

const config = (
  commands: readonly string[] = ["printf '%s\\n' {{changed_paths}}"],
  match = '*.ts',
) => ({
  tasks: {
    check: {
      when: [{ on: 'change', skip: ['check'] }],
      match: [match],
      run: commands,
    },
  },
})

const inRepo = async (
  settings: Readonly<Record<string, unknown>>,
  body: (root: string) => Promise<void>,
  commit = true,
) => {
  const root = mkdtempSync(join(tmpdir(), 'crust-verify-'))
  try {
    git(root, 'init', '-q', '-b', 'main')
    git(root, 'config', 'user.name', 'tester')
    git(root, 'config', 'user.email', 'tester@example.com')
    git(root, 'config', 'commit.gpgsign', 'false')
    mkdirSync(join(root, '.pi-crust', 'config'), { recursive: true })
    writeFileSync(join(root, '.gitignore'), '.pi-crust/data/\n')
    writeFileSync(
      join(root, '.pi-crust', 'config', 'crust.config.yaml'),
      Bun.YAML.stringify(settings),
    )
    writeFileSync(join(root, 'tracked file.ts'), 'initial')
    if (commit) {
      git(root, 'add', '.')
      git(root, 'commit', '-qm', 'initial')
    }
    await body(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const verify = (root: string, args: readonly string[] = []) =>
  inDir(root, () => capture(process.stdout)(() => main(args)))
const log = (root: string) =>
  readFileSync(
    join(
      root,
      '.pi-crust/data/checks',
      root.split('/').at(-1) ?? '',
      '01_check.log',
    ),
    'utf8',
  )

for (const path of ['tracked file.ts', "a b; echo pwned $HOME's.ts"]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given a change to ${path}`,
      'when verifying the working tree',
      'it should deliver the verbatim filename and print start before completion',
    ].join(', '),
    async () => {
      // given
      await inRepo(
        config(['set -- {{changed_paths}}; printf \'%s\\n\' "$#" "$@"']),
        async (root) => {
          writeFileSync(join(root, path), 'edited')
          // when
          const actual = await verify(root)
          // then
          expect(actual.result).toBe(EXIT.SUCCESS)
          expect(log(root)).toContain(
            `--- stdout ---\n1\n${path}\n\n--- stderr ---`,
          )
          expect(actual.printed).toMatch(
            /task check: set -- [\s\S]*task check: passed/,
          )
        },
      )
    },
  )
}

for (const fixture of [
  { settings: {}, filename: '', note: 'no tasks are declared' },
  {
    settings: config(),
    filename: '',
    note: 'nothing changed — no tasks apply',
  },
  {
    settings: config(),
    filename: 'a.md',
    note: '1 path(s) changed that no task matched',
  },
]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given ${fixture.note}`,
      'when verifying the working tree',
      'it should exit successfully without claiming that a task passed',
    ].join(', '),
    async () => {
      // given
      await inRepo(fixture.settings, async (root) => {
        if (fixture.filename !== '')
          writeFileSync(join(root, fixture.filename), 'new')
        // when
        const actual = await verify(root)
        // then
        expect(actual.result).toBe(EXIT.SUCCESS)
        expect(actual.printed).toContain(fixture.note)
        expect(actual.printed).not.toContain('task(s) passed')
      })
    },
  )
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a failing command followed by a passing command',
    'when verifying a matching change',
    'it should run both commands and exit with failure',
  ].join(', '),
  async () => {
    // given
    await inRepo(config(['false', 'printf second']), async (root) => {
      writeFileSync(join(root, 'changed.ts'), 'changed')
      // when
      const actual = await verify(root)
      // then
      expect(actual.result).toBe(EXIT.FAILED)
      expect(actual.printed).toContain('`false` exited 1')
      expect(log(root)).toContain('--- stdout ---\nsecond')
    })
  },
)

for (const { settings, args, note } of [
  {
    settings: {
      tasks: { check: { when: [{ on: 'change' }], run: 'true', other: true } },
    },
    args: [],
    note: 'other',
  },
  { settings: config(), args: ['--scope', 'nonexistent'], note: 'nonexistent' },
]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given an invalid evaluation (${note})`,
      'when verifying the working tree',
      'it should print the error to stderr and fail',
    ].join(', '),
    async () => {
      // given
      await inRepo(settings, async (root) => {
        // when
        const actual = await inDir(root, () =>
          capture(process.stderr)(() => main(args)),
        )
        // then
        expect(actual.result).toBe(EXIT.FAILED)
        expect(actual.printed).toContain(note)
      })
    },
  )
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a staged and an untracked path before the first commit',
    'when verifying the working tree',
    'it should select both and render an empty base argument',
  ].join(', '),
  async () => {
    // given
    await inRepo(
      config([
        'set -- {{base_ref}} {{changed_paths}}; printf \'%s\\n\' "$#" "$@"',
      ]),
      async (root) => {
        git(root, 'add', 'tracked file.ts')
        writeFileSync(join(root, 'untracked.ts'), 'new')
        // when
        const actual = await verify(root)
        // then
        expect(actual.result).toBe(EXIT.SUCCESS)
        expect(log(root)).toContain(
          '--- stdout ---\n3\n\ntracked file.ts\nuntracked.ts\n',
        )
      },
      false,
    )
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a matching command that exceeds its one-second timeout',
    'when verifying',
    'it should fail and print the timeout note',
  ].join(', '),
  async () => {
    // given
    await inRepo(
      { ...config(['sleep 30']), task_config: { timeout_seconds: 1 } },
      async (root) => {
        writeFileSync(join(root, 'slow.ts'), 'change')
        // when
        const actual = await verify(root)
        // then
        expect(actual.result).toBe(EXIT.FAILED)
        expect(actual.printed).toContain('`sleep 30` timed out after 1s')
      },
    )
  },
)

const nestedWorkspace = (root: string): string => {
  const workspace = join(root, 'packages/app')
  mkdirSync(join(workspace, '.pi-crust'), { recursive: true })
  mkdirSync(join(workspace, 'src'))
  writeFileSync(join(workspace, 'src/x.ts'), 'initial')
  writeFileSync(join(workspace, 'README.md'), 'shadow')
  writeFileSync(join(root, 'README.md'), 'initial')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'nested workspace')
  return workspace
}

for (const { scope, commit, untracked } of [
  { scope: 'HEAD~1..HEAD', commit: true, untracked: false },
  { scope: 'HEAD', commit: false, untracked: true },
]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given a nested workspace with a file shadowing a changed Git-root file (${scope})`,
      'when verifying an explicit scope',
      'it should match the Git-root file and use the workspace spelling only for untracked paths',
    ].join(', '),
    async () => {
      // given
      const entry = {
        when: [{ on: 'change' }],
        run: "printf '%s\\n' {{changed_paths}}",
      }
      await inRepo(
        {
          tasks: {
            check: { ...entry, match: ['README.md'] },
            shadow: { ...entry, match: ['packages/app/README.md'] },
            nested: { ...entry, match: ['packages/app/*.ts'] },
          },
        },
        async (root) => {
          const workspace = nestedWorkspace(root)
          writeFileSync(join(root, 'README.md'), 'changed')
          if (commit) git(root, 'commit', '-qam', 'change root README')
          if (untracked) writeFileSync(join(workspace, 'new.ts'), 'new')
          // when
          const actual = await verify(workspace, [
            '--config',
            join(root, '.pi-crust/config/crust.config.yaml'),
            '--scope',
            scope,
          ])
          // then
          expect(actual.result).toBe(EXIT.SUCCESS)
          expect(actual.printed).toContain(
            "task check: printf '%s\\n' README.md",
          )
          expect(actual.printed).not.toContain('task shadow:')
          expect(
            actual.printed.includes(
              "task nested: printf '%s\\n' packages/app/new.ts",
            ),
          ).toBe(untracked)
        },
      )
    },
  )
}

for (const { scope, cwd, expected } of [
  { scope: [], cwd: 'packages/app', expected: 'src/x.ts' },
  {
    scope: ['--scope', 'src/x.ts'],
    cwd: '',
    expected: 'packages/app/src/x.ts',
  },
]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given a changed path inside a nested workspace (scope ${scope.join(' ')})`,
      'when verifying it from the nested workspace',
      'it should match from the Git root and render paths from the task cwd',
    ].join(', '),
    async () => {
      // given
      await inRepo(
        {
          tasks: {
            check: {
              when: [{ on: 'change' }],
              match: ['packages/app/**/*.ts'],
              cwd,
              run: "printf '%s\\n' {{changed_paths}}",
            },
          },
        },
        async (root) => {
          const workspace = nestedWorkspace(root)
          writeFileSync(join(workspace, 'src/x.ts'), 'edited')
          // when
          const actual = await verify(workspace, [
            '--config',
            join(root, '.pi-crust/config/crust.config.yaml'),
            ...scope,
          ])
          // then
          expect(actual.result).toBe(EXIT.SUCCESS)
          expect(actual.printed).toContain(
            `task check: printf '%s\\n' ${expected}`,
          )
        },
      )
    },
  )
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a clone whose remote defaults to dev and a task matching a committed edit',
    'when verifying implicit and explicit range bases',
    'it should select the same command and resolved base',
  ].join(', '),
  async () => {
    // given
    await inRepo(
      config(["printf '%s\\n' {{base_ref}} {{changed_paths}}"]),
      async (root) => {
        git(root, 'branch', '-m', 'dev')
        const remote = join(root, 'remote.git')
        git(root, 'clone', '-q', '--bare', root, remote)
        const work = join(root, 'work')
        git(root, 'clone', '-q', remote, work)
        git(work, 'config', 'user.name', 'tester')
        git(work, 'config', 'user.email', 'tester@example.com')
        git(work, 'config', 'commit.gpgsign', 'false')
        git(work, 'checkout', '-qb', 'feature')
        writeFileSync(join(work, 'feature.ts'), 'feature')
        git(work, 'add', 'feature.ts')
        git(work, 'commit', '-qm', 'feature')
        // when
        const implicit = await verify(work, ['--scope', '...HEAD'])
        const explicit = await verify(work, ['--scope', 'dev...HEAD'])
        // then
        expect(implicit.result).toBe(EXIT.SUCCESS)
        expect(explicit.result).toBe(EXIT.SUCCESS)
        expect(implicit.printed.split('\n')[0]).toBe(
          explicit.printed.split('\n')[0],
        )
        expect(implicit.printed).toContain('all 1 task(s) passed')
      },
    )
  },
)
