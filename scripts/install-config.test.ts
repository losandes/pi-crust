import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const CONFIG_FILES = {
  'crust.config.yaml': 'defaults:\n  model: template\n',
  'theme.css': ':root { --background: black; }\n',
  'nested/routing.yaml': 'checks: []\n',
  'crust.activities-bic.example.yaml': 'activities: []\n',
  'nested/roster.example.yaml': 'activities: []\n',
} as const

const NON_EXAMPLES = Object.keys(CONFIG_FILES).filter(
  (name) => !name.endsWith('.example.yaml'),
)

const MODES = [
  { name: 'no flags', args: [], refresh: false },
  { name: '--refresh', args: ['--refresh'], refresh: true },
  { name: 'the deprecated --force alias', args: ['--force'], refresh: true },
] as const

type TFixture = Readonly<{
  root: string
  config: string
  templates: string
  install: (...args: readonly string[]) => string
}>

const put = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

const withFixture = (run: (fixture: TFixture) => void): void => {
  const scratch = realpathSync(
    mkdtempSync(join(tmpdir(), 'crust-install-config-')),
  )
  try {
    const home = join(scratch, 'package')
    const root = join(scratch, 'repository')
    const templates = join(home, 'templates', 'stamp', 'config')
    const script = join(home, 'scripts', 'install.ts')
    mkdirSync(dirname(script), { recursive: true })
    copyFileSync(join(import.meta.dir, 'install.ts'), script)
    mkdirSync(root)
    for (const [name, content] of Object.entries(CONFIG_FILES)) {
      put(join(templates, name), content)
    }
    put(join(home, 'templates', 'env.example'), 'KEY=template\n')
    run({
      root,
      config: join(root, '.pi-crust', 'config'),
      templates,
      install: (...args) =>
        execFileSync('bun', [script, ...args], { cwd: root, encoding: 'utf8' }),
    })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

for (const { name, args } of MODES) {
  test(
    [
      'given a repository without config/',
      `when installing with ${name}`,
      'it should seed every initial config file, including nested settings and themes',
    ].join(', '),
    () => {
      // given
      withFixture(({ config, install }) => {
        // when
        install(...args)

        // then
        for (const [path, content] of Object.entries(CONFIG_FILES)) {
          expect(readFileSync(join(config, path), 'utf8')).toBe(content)
        }
      })
    },
  )
}

test(
  [
    'given a stamped repository with edited config files and examples',
    'when installing twice more without flags',
    'it should preserve every config byte and distinguish repo ownership from existing examples',
  ].join(', '),
  () => {
    // given
    withFixture(({ config, install }) => {
      install()
      const paths = [...Object.keys(CONFIG_FILES), 'team-only.yaml']
      for (const path of paths) {
        put(join(config, path), `repository edits to ${path}\r\n`)
      }
      const before = paths.map((path) => readFileSync(join(config, path)))

      // when
      const reports = [install(), install()]

      // then
      expect(paths.map((path) => readFileSync(join(config, path)))).toEqual(
        before,
      )
      for (const report of reports) {
        expect(report).toContain('skipped (exists)')
        expect(report).toContain('left to the repository (config/)')
        expect(report).toContain('config/ is repo-owned')
        expect(report).toContain(join(config, 'crust.config.yaml'))
        expect(report).not.toContain('use --force to overwrite')
      }
    })
  },
)

for (const { name, args } of MODES) {
  test(
    [
      'given a stamped repository and new non-example templates under config/',
      `when reinstalling with ${name}`,
      'it should preserve existing settings and leave new settings, nested files, and themes to the repository',
    ].join(', '),
    () => {
      // given
      withFixture(({ config, templates, install }) => {
        install()
        for (const path of NON_EXAMPLES) {
          put(join(config, path), `team-owned ${path}\r\n`)
        }
        const before = NON_EXAMPLES.map((path) =>
          readFileSync(join(config, path)),
        )
        const additions = [
          'new-settings.yaml',
          'new/theme.css',
          'new/roster.yaml',
        ]
        for (const path of additions) {
          put(join(templates, path), `new template ${path}\n`)
        }

        // when
        const report = install(...args)

        // then
        expect(
          NON_EXAMPLES.map((path) => readFileSync(join(config, path))),
        ).toEqual(before)
        for (const path of additions) {
          expect(existsSync(join(config, path))).toBe(false)
          expect(report).toContain(join(config, path))
        }
        expect(report).toContain('left to the repository (config/)')
        expect(report).toContain(
          'non-.example.yaml files are neither added nor overwritten',
        )
      })
    },
  )
}

test(
  [
    'given an existing empty config/ directory',
    'when installing without flags',
    'it should add only examples rather than treating missing settings as a fresh install',
  ].join(', '),
  () => {
    // given
    withFixture(({ config, install }) => {
      mkdirSync(config, { recursive: true })

      // when
      const report = install()

      // then
      for (const path of NON_EXAMPLES) {
        expect(existsSync(join(config, path))).toBe(false)
      }
      expect(
        readFileSync(join(config, 'nested/roster.example.yaml'), 'utf8'),
      ).toBe(CONFIG_FILES['nested/roster.example.yaml'])
      expect(report).toContain('added to config/ (new since your install)')
    })
  },
)

for (const { name, args, refresh } of MODES) {
  test(
    [
      'given edited examples, an edited template-owned env file, and new example templates',
      `when reinstalling with ${name}`,
      `it should ${refresh ? 'refresh' : 'skip'} existing template-owned files and report new config examples separately`,
    ].join(', '),
    () => {
      // given
      withFixture(({ root, config, templates, install }) => {
        install()
        const examples = Object.keys(CONFIG_FILES).filter((path) =>
          path.endsWith('.example.yaml'),
        )
        for (const path of examples) {
          put(join(config, path), 'repository example\r\n')
          put(join(templates, path), 'updated template example\n')
        }
        const env = join(root, '.env.pi-crust.example')
        put(env, 'KEY=repository\r\n')
        put(join(templates, '..', '..', 'env.example'), 'KEY=updated\n')
        const added = 'new/agents.example.yaml'
        put(join(templates, added), 'activities: [new]\n')

        // when
        const report = install(...args)

        // then
        for (const path of examples) {
          expect(readFileSync(join(config, path), 'utf8')).toBe(
            refresh ? 'updated template example\n' : 'repository example\r\n',
          )
        }
        expect(readFileSync(env, 'utf8')).toBe(
          refresh ? 'KEY=updated\n' : 'KEY=repository\r\n',
        )
        expect(readFileSync(join(config, added), 'utf8')).toBe(
          'activities: [new]\n',
        )
        expect(report).toContain(
          `added to config/ (new since your install): 1 file(s)\n    + ${join(config, added)}`,
        )
        expect(report).toContain(refresh ? 'stamped:' : 'skipped (exists)')
        if (args.some((arg) => arg === '--force')) {
          expect(report).toContain('--force is deprecated; use --refresh')
          expect(report).toContain('0.1.x')
        } else {
          expect(report).not.toContain('--force is deprecated')
        }
      })
    },
  )
}
