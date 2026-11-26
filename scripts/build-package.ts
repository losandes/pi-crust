#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { build } from 'esbuild'
import { RECIPE_DOCS } from '../runtime/domains/cli'
import { PACKAGE_ROOT } from '../runtime/lib/system'

const filesUnder = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(path) : entry.isFile() ? [path] : []
  })

type TUiBuild = (
  command: string,
  args: readonly string[],
  options: Readonly<{ cwd: string; stdio: 'inherit' }>,
) => Readonly<{ status: number | null }>

export const buildPackageWith =
  (runUi: TUiBuild) =>
  async (out: string): Promise<number> => {
    const output = resolve(out)
    const marker = join(output, '.pi-crust-build')
    if (
      existsSync(output) &&
      (!statSync(output).isDirectory() ||
        (readdirSync(output).length > 0 && !existsSync(marker)))
    ) {
      process.stderr.write(
        `build:package: refusing to empty unmarked output ${output}\n`,
      )
      return 2
    }
    if (existsSync(output)) rmSync(output, { recursive: true })
    mkdirSync(output, { recursive: true })
    writeFileSync(marker, '')
    const options = {
      bundle: true,
      platform: 'node' as const,
      format: 'esm' as const,
      target: 'node22.19',
      splitting: false,
      outbase: PACKAGE_ROOT,
      outdir: output,
    }
    const entries = [
      ...new Set([
        'runtime/cli.ts',
        ...RECIPE_DOCS.map((doc) => doc.run.script),
        'apps/visualizer/server/index.ts',
      ]),
    ]
    await build({
      ...options,
      packages: 'external',
      entryPoints: entries.map((path) => join(PACKAGE_ROOT, path)),
    })
    await build({
      ...options,
      entryPoints: [join(PACKAGE_ROOT, 'runtime/extensions/path-policy.ts')],
    })
    filesUnder(output)
      .filter((path) => path.endsWith('.js'))
      .forEach((path) => {
        const text = readFileSync(path, 'utf8')
        if (text.startsWith('#!/usr/bin/env bun\n'))
          writeFileSync(
            path,
            text.replace(/^#!\/usr\/bin\/env bun\n/, '#!/usr/bin/env node\n'),
          )
      })
    chmodSync(join(output, 'runtime/cli.js'), 0o755)
    const assets = [
      ...filesUnder(join(PACKAGE_ROOT, 'runtime/config')).filter((path) =>
        path.endsWith('.toml'),
      ),
      ...filesUnder(join(PACKAGE_ROOT, 'runtime/prompts')).filter((path) =>
        path.endsWith('.md'),
      ),
      ...[
        'templates/pi-crust.toml',
        'templates/env.example',
        'LICENSE',
        'README.md',
        'references/config.md',
      ].map((path) => join(PACKAGE_ROOT, path)),
    ]
    assets.forEach((path) => {
      const destination = join(output, relative(PACKAGE_ROOT, path))
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(path, destination)
    })
    const ui = runUi(
      process.execPath,
      [
        'x',
        'vite',
        'build',
        '--outDir',
        join(output, 'apps/visualizer/dist'),
        '--emptyOutDir',
      ],
      {
        cwd: join(PACKAGE_ROOT, 'apps/visualizer'),
        stdio: 'inherit',
      },
    )
    if (ui.status !== 0) {
      process.stderr.write('build:package: web UI build failed\n')
      return 1
    }
    writeFileSync(join(output, '.npmignore'), '.pi-crust-build\n')
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
    )
    writeFileSync(
      join(output, 'package.json'),
      `${JSON.stringify(
        {
          name: '@polyn/pi-crust',
          version: manifest.version,
          description: manifest.description,
          license: manifest.license,
          type: 'module',
          bin: { crust: 'runtime/cli.js' },
          engines: { node: manifest.engines.node },
          dependencies: manifest.dependencies,
          publishConfig: { access: 'public' },
        },
        undefined,
        2,
      )}\n`,
    )
    return 0
  }

export const buildPackage = buildPackageWith(spawnSync)

export const main = async (argv: readonly string[]): Promise<number> => {
  if (
    argv.length !== 0 &&
    (argv.length !== 2 || argv[0] !== '--out' || !argv[1])
  ) {
    process.stderr.write(
      'usage: bun scripts/build-package.ts [--out <directory>]\n',
    )
    return 2
  }
  return await buildPackage(argv[1] ?? join(PACKAGE_ROOT, 'dist'))
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2))
