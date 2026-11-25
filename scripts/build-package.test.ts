import { expect, mock, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { RECIPE_DOCS } from '../runtime/domains/cli'
import { PACKAGE_ROOT } from '../runtime/lib/system'
import { SKIP_INTEGRATION } from '../runtime/testing/integration'
import { buildPackage, buildPackageWith, main } from './build-package'

const filesUnder = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  })

test.skipIf(SKIP_INTEGRATION)(
  [
    'given the source package and a marked output directory',
    'when built and rebuilt',
    'it should emit the complete installable package with its own executable manifest',
  ].join(', '),
  async () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-package-'))
    const out = join(dir, 'pkg')
    try {
      // when
      expect(await main(['--out', out])).toBe(0)
      const manifest = JSON.parse(
        readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
      )
      const actual = filesUnder(out)
        .map((path) => relative(out, path))
        .toSorted()
      const programs = [
        ...new Set([
          'runtime/cli.ts',
          ...RECIPE_DOCS.map((doc) => doc.run.script),
          'apps/visualizer/server/index.ts',
          'runtime/extensions/path-policy.ts',
        ]),
      ].map((path) => path.replace(/\.ts$/, '.js'))
      const assets = [
        ...filesUnder(join(PACKAGE_ROOT, 'runtime/config')).filter((path) =>
          path.endsWith('.toml'),
        ),
        ...filesUnder(join(PACKAGE_ROOT, 'runtime/prompts')).filter((path) =>
          path.endsWith('.md'),
        ),
      ].map((path) => relative(PACKAGE_ROOT, path))
      // then
      expect(actual).toEqual(
        [
          ...programs,
          ...assets,
          '.pi-crust-build',
          '.npmignore',
          'README.md',
          'references/config.md',
          ...actual.filter((path) => path.startsWith('apps/visualizer/dist/')),
          'package.json',
          'templates/pi-crust.toml',
          'templates/env.example',
          'LICENSE',
        ].toSorted(),
      )
      expect(
        JSON.parse(readFileSync(join(out, 'package.json'), 'utf8')),
      ).toEqual({
        name: '@polyn/pi-crust',
        version: manifest.version,
        description: manifest.description,
        license: manifest.license,
        type: 'module',
        bin: { crust: 'runtime/cli.js' },
        engines: { node: manifest.engines.node },
        dependencies: manifest.dependencies,
        publishConfig: { access: 'public' },
      })
      expect(actual).toContain('apps/visualizer/dist/index.html')
      expect(
        actual.some((path) => path.startsWith('apps/visualizer/dist/assets/')),
      ).toBe(true)
      expect(readFileSync(join(out, '.npmignore'), 'utf8')).toBe(
        '.pi-crust-build\n',
      )
      expect(statSync(join(out, 'runtime/cli.js')).mode & 0o777).toBe(0o755)
      for (const path of programs.filter((path) =>
        readFileSync(
          join(PACKAGE_ROOT, path.replace(/\.js$/, '.ts')),
          'utf8',
        ).startsWith('#!/usr/bin/env bun\n'),
      )) {
        expect(readFileSync(join(out, path), 'utf8').split('\n')[0]).toBe(
          '#!/usr/bin/env node',
        )
      }
      for (const path of [
        ...assets,
        'templates/pi-crust.toml',
        'templates/env.example',
        'LICENSE',
        'README.md',
        'references/config.md',
      ])
        expect(readFileSync(join(out, path))).toEqual(
          readFileSync(join(PACKAGE_ROOT, path)),
        )
      writeFileSync(join(out, 'stale'), 'old build')
      expect(await buildPackage(out)).toBe(0)
      expect(
        filesUnder(out)
          .map((path) => relative(out, path))
          .toSorted(),
      ).toEqual(actual)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
  60000,
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a scratch package build',
    'when the UI build fails',
    'it should target only the requested UI output and return failure',
  ].join(', '),
  async () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-package-ui-'))
    const out = join(dir, 'pkg')
    const runUi = mock(
      (_command: string, _args: readonly string[], _options: unknown) => ({
        status: 1,
      }),
    )
    try {
      // when
      const status = await buildPackageWith(runUi)(out)
      // then
      expect(status).toBe(1)
      expect(runUi.mock.calls).toEqual([
        [
          process.execPath,
          [
            'x',
            'vite',
            'build',
            '--outDir',
            join(out, 'apps/visualizer/dist'),
            '--emptyOutDir',
          ],
          { cwd: join(PACKAGE_ROOT, 'apps/visualizer'), stdio: 'inherit' },
        ],
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
  30000,
)

test(
  [
    'given an unmarked nonempty output or a file',
    'when building or parsing invalid arguments',
    'it should refuse without deleting user files',
  ].join(', '),
  async () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-package-refusal-'))
    const out = join(dir, 'pkg')
    mkdirSync(out)
    const owned = join(out, 'keep')
    writeFileSync(owned, 'user content')
    try {
      // when
      const refused = await buildPackage(out)
      const file = await buildPackage(owned)
      const invalid = await main(['--unknown'])
      // then
      expect(refused).toBe(2)
      expect(file).toBe(2)
      expect(invalid).toBe(2)
      expect(readFileSync(owned, 'utf8')).toBe('user content')
      expect(existsSync(out)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)
