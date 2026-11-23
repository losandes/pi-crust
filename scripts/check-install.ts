#!/usr/bin/env bun
/** Verify a disposable fresh install: the exact file set, inactive tasks and a usable catalogue. */
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { installFaults } from './install-faults'

const packageRoot = resolve(import.meta.dir, '..')

const main = (): number => {
  const probe = mkdtempSync(join(tmpdir(), 'crust-check-install-'))
  const home = mkdtempSync(join(tmpdir(), 'crust-check-home-'))
  try {
    const installed = spawnSync(
      'bun',
      [join(packageRoot, 'scripts/install.ts')],
      { cwd: probe, env: { ...process.env, HOME: home }, stdio: 'inherit' },
    )
    if (installed.status !== 0) {
      process.stderr.write(
        `check-install: install.ts exited ${installed.status ?? 1} — nothing to compare\n`,
      )
      return 2
    }
    const path = join(probe, 'pi-crust.toml')
    const files = readdirSync(probe, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) =>
        join(entry.parentPath, entry.name)
          .slice(probe.length + 1)
          .replaceAll('\\', '/'),
      )
    const faults = installFaults({
      files,
      home: packageRoot,
      record: readFileSync(join(home, '.pi-crust', 'pi-crust-home'), 'utf8'),
      installed: existsSync(path) ? readFileSync(path, 'utf8') : '',
      template: readFileSync(
        join(packageRoot, 'templates/pi-crust.toml'),
        'utf8',
      ),
    })
    const {
      CRUST_CONFIG: _config,
      CRUST_PACKAGE_CONFIG: _package,
      ...environment
    } = process.env
    const listed = spawnSync(
      'bun',
      [join(packageRoot, 'runtime/commands/list.ts')],
      {
        cwd: probe,
        env: {
          ...environment,
          HOME: home,
          CRUST_MACHINE_CONFIG: join(probe, 'no-machine-config'),
        },
        stdio: 'inherit',
      },
    )
    const all = [
      ...faults,
      ...(listed.status === 0
        ? []
        : [`list.ts exited ${listed.status ?? 1} after a fresh install`]),
    ]
    all.forEach((fault) => {
      process.stderr.write(`check-install: ${fault}\n`)
    })
    return all.length === 0 ? 0 : 1
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(probe, { recursive: true, force: true })
  }
}

if (import.meta.main) process.exit(main())
