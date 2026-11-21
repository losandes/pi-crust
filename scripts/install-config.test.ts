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

const reportPaths = (report: string, heading: string): readonly string[] => {
  const lines = report.split('\n')
  const start = lines.findIndex((line) => line.startsWith(`  ${heading}:`))
  if (start === -1) {
    return []
  }
  const remaining = lines.slice(start + 1)
  const end = remaining.findIndex((line) => !/^ {4}[+=] /.test(line))
  return remaining
    .slice(0, end === -1 ? remaining.length : end)
    .map((line) => line.slice(6))
}

const EXAMPLE_LOOKALIKES = [
  'new/agents.example.yml',
  'new/agents.example.yaml.backup',
  'new.example.yaml/agents.yaml',
] as const

// SC<n> refers to acceptance criterion n in issue #114.
for (const { name, args, refresh } of MODES) {
  test(
    [
      'given SC4/SC5: a repository that deliberately removed a config file',
      `when reinstalling with ${name}`,
      'it should keep the file absent and report that adopting it belongs to the repository',
    ].join(', '),
    () => {
      // given
      withFixture(({ config, templates, install }) => {
        install()
        const removed = join(config, 'nested/routing.yaml')
        rmSync(removed)
        put(join(templates, 'nested/routing.yaml'), 'checks: [new-default]\n')

        // when
        const report = install(...args)

        // then
        expect(existsSync(removed)).toBe(false)
        expect(
          reportPaths(report, 'left to the repository (config/)'),
        ).toContain(removed)
        expect(reportPaths(report, 'stamped')).not.toContain(removed)
      })
    },
  )

  for (const path of EXAMPLE_LOOKALIKES) {
    test(
      [
        `given SC4/SC5: an existing config/ and a new ${path} template`,
        `when reinstalling with ${name}`,
        'it should not treat a lookalike filename or directory as a .example.yaml file',
      ].join(', '),
      () => {
        // given
        withFixture(({ config, templates, install }) => {
          install()
          put(join(templates, path), 'activities: [not-an-example]\n')
          const destination = join(config, path)

          // when
          const report = install(...args)

          // then
          expect(existsSync(destination)).toBe(false)
          expect(
            reportPaths(report, 'left to the repository (config/)'),
          ).toContain(destination)
          expect(
            reportPaths(report, 'added to config/ (new since your install)'),
          ).not.toContain(destination)
        })
      },
    )
  }

  test(
    [
      'given SC1/SC2/SC3/SC5: edited files and new config and prompt templates',
      `when reinstalling with ${name}`,
      'it should distinguish additions, replacements, existing-file skips, and config exclusions without double-counting paths',
    ].join(', '),
    () => {
      // given
      withFixture(({ root, config, templates, install }) => {
        const promptTemplate = join(templates, '..', 'prompts', 'README.md')
        put(promptTemplate, 'template prompt\n')
        install()
        const paths = {
          setting: join(config, 'crust.config.yaml'),
          unadopted: join(config, 'new/settings.yaml'),
          example: join(config, 'nested/roster.example.yaml'),
          newExample: join(config, 'new/agents.example.yaml'),
          nestedExample: join(config, 'new/nested/agents.example.yaml'),
          prompt: join(root, '.pi-crust', 'prompts', 'README.md'),
          newPrompt: join(root, '.pi-crust', 'prompts', 'new.md'),
        }
        put(paths.setting, 'repository settings\r\n')
        put(paths.example, 'repository example\r\n')
        put(paths.prompt, 'repository prompt\r\n')
        put(join(templates, 'new/settings.yaml'), 'settings: [unadopted]\n')
        put(join(templates, 'new/agents.example.yaml'), 'activities: [new]\n')
        put(
          join(templates, 'new/nested/agents.example.yaml'),
          'activities: [nested]\n',
        )
        put(join(templates, '..', 'prompts', 'new.md'), 'new prompt\n')

        // when
        const report = install(...args)

        // then
        expect(readFileSync(paths.prompt, 'utf8')).toBe(
          refresh ? 'template prompt\n' : 'repository prompt\r\n',
        )
        expect(readFileSync(paths.newPrompt, 'utf8')).toBe('new prompt\n')
        const expectedSections = [
          [
            'stamped',
            refresh
              ? [paths.example, paths.prompt, paths.newPrompt]
              : [paths.newPrompt],
          ],
          [
            'added to config/ (new since your install)',
            [paths.newExample, paths.nestedExample],
          ],
          ['skipped (exists)', refresh ? [] : [paths.example, paths.prompt]],
          [
            'left to the repository (config/)',
            [paths.setting, paths.unadopted],
          ],
        ] as const
        const observedPaths = Object.values(paths)
        for (const [heading, expected] of expectedSections) {
          const actual = reportPaths(report, heading)
          expect(
            actual.filter((path) => observedPaths.includes(path)).toSorted(),
          ).toEqual(expected.toSorted())
          if (actual.length > 0) {
            expect(report).toContain(`  ${heading}: ${actual.length} file(s)`)
          }
        }
      })
    },
  )
}
