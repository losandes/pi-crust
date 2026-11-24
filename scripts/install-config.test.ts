import { expect, test } from 'bun:test'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { SKIP_INTEGRATION } from '../runtime/testing/integration'
import { FRESH_INSTALL_FILES, installFaults } from './install-faults'

const MODES = [[], ['--refresh'], ['--force']] as const
const put = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
const filesUnder = (root: string): readonly string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
    .toSorted()

const fixture = () => {
  const scratch = realpathSync(
    mkdtempSync(join(tmpdir(), 'crust-install-toml-')),
  )
  const home = join(scratch, 'package')
  const userHome = join(scratch, 'user')
  const root = join(scratch, 'repository')
  mkdirSync(join(home, 'scripts'), { recursive: true })
  mkdirSync(root)
  for (const name of ['install.ts', 'make-config.ts'])
    copyFileSync(join(import.meta.dir, name), join(home, 'scripts', name))
  put(
    join(home, 'templates/pi-crust.toml'),
    readFileSync(join(import.meta.dir, '../templates/pi-crust.toml'), 'utf8'),
  )
  put(join(home, 'templates/env.example'), 'KEY=template\n')
  return {
    root,
    home,
    userHome,
    install: (...args: readonly string[]) =>
      execFileSync('bun', [join(home, 'scripts/install.ts'), ...args], {
        cwd: root,
        env: { ...process.env, HOME: userHome },
        encoding: 'utf8',
      }),
    make: (...args: readonly string[]) =>
      spawnSync('bun', [join(home, 'scripts/make-config.ts'), ...args], {
        cwd: root,
        env: { ...process.env, HOME: userHome },
        encoding: 'utf8',
      }),
    [Symbol.dispose]: () => rmSync(scratch, { recursive: true, force: true }),
  }
}

for (const args of MODES) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given @SC1 @SC2 a fresh repository and installer flags ${args.join(' ')}`,
      'when installed',
      'it should create exactly three files with one empty TOML configuration and no prompt or configuration directory',
    ].join(', '),
    () => {
      // given
      using f = fixture()
      // when
      const report = f.install(...args)
      const installed = readFileSync(join(f.root, 'pi-crust.toml'), 'utf8')
      const files = filesUnder(f.root)
      // then
      expect(files).toEqual(FRESH_INSTALL_FILES)
      expect(Bun.TOML.parse(installed)).toEqual({})
      expect(
        installFaults({
          files,
          installed,
          template: readFileSync(
            join(f.home, 'templates/pi-crust.toml'),
            'utf8',
          ),
        }),
      ).toEqual([])
      expect(existsSync(join(f.root, '.pi-crust/config'))).toBe(false)
      expect(existsSync(join(f.root, '.pi-crust/prompts'))).toBe(false)
      expect(
        readFileSync(join(f.root, '.gitignore'), 'utf8')
          .split('\n')
          .filter((line) => line !== '' && !line.startsWith('#')),
      ).toEqual(['.pi-crust/data/'])
      expect(report.includes('--force is deprecated')).toBe(
        args.some((arg) => arg === '--force'),
      )
    },
  )

  test.skipIf(SKIP_INTEGRATION)(
    [
      `given @SC3 an edited repository TOML file and legacy files, flags ${args.join(' ')}`,
      'when reinstalled twice',
      'it should leave all repository configuration and prompt bytes unchanged and announce hand migration',
    ].join(', '),
    () => {
      // given
      using f = fixture()
      f.install()
      const paths = [
        'pi-crust.toml',
        '.pi-crust/config/crust.config.yaml',
        '.pi-crust/config/nested/custom.toml',
        '.pi-crust/config/roster.example.yaml',
        '.pi-crust/config/theme.css',
        '.pi-crust/prompts/plan/system.md',
        '.pi-crust/prompts/example/user.md',
      ]
      paths.forEach((path) => {
        put(join(f.root, path), `repository-owned ${path}\r\n`)
      })
      const before = paths.map((path) => readFileSync(join(f.root, path)))
      // when
      const reports = [f.install(...args), f.install(...args)]
      // then
      expect(paths.map((path) => readFileSync(join(f.root, path)))).toEqual(
        before,
      )
      for (const report of reports) {
        expect(report).toContain('no longer read, left untouched')
        expect(report).toContain('Migrate by hand')
        expect(report).toContain('references/config.md')
        expect(report).not.toContain('added to config/')
        expect(report).not.toContain('left to the repository (config/)')
      }
    },
  )

  test.skipIf(SKIP_INTEGRATION)(
    [
      `given an edited credential example and flags ${args.join(' ')}`,
      'when reinstalling',
      'it should refresh only template-owned files when requested',
    ].join(', '),
    () => {
      // given
      using f = fixture()
      f.install()
      put(join(f.root, '.env.pi-crust.example'), 'KEY=repository\r\n')
      put(join(f.home, 'templates/env.example'), 'KEY=updated\n')
      // when
      f.install(...args)
      // then
      expect(readFileSync(join(f.root, '.env.pi-crust.example'), 'utf8')).toBe(
        args.length === 0 ? 'KEY=repository\r\n' : 'KEY=updated\n',
      )
    },
  )
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given make-config and a repository-owned TOML file',
    'when generated with and without force',
    'it should refuse replacement by default and replace only when explicitly forced',
  ].join(', '),
  () => {
    // given
    using f = fixture()
    // when
    const created = f.make()
    put(join(f.root, 'pi-crust.toml'), '# repository settings\r\n')
    const refused = f.make()
    const unchanged = readFileSync(join(f.root, 'pi-crust.toml'), 'utf8')
    const forced = f.make('--force')
    // then
    expect(created.status).toBe(0)
    expect(refused.status).toBe(1)
    expect(unchanged).toBe('# repository settings\r\n')
    expect(forced.status).toBe(0)
    expect(readFileSync(join(f.root, 'pi-crust.toml'), 'utf8')).toBe(
      readFileSync(join(f.home, 'templates/pi-crust.toml'), 'utf8'),
    )
  },
)
