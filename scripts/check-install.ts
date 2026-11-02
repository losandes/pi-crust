#!/usr/bin/env bun
/**
 * check-install — prove a fresh stamp is the tree this package ships.
 *
 * Usage:
 *     bun scripts/check-install.ts
 *
 * `install.ts` stamps `templates/stamp/` into a repository as `.pi-crust/`,
 * and `verify-install.sh` compares the two. A file edited in one and not the
 * other ships a factory that behaves differently from the one it was tested
 * in, and nothing about that is visible until a run does something
 * unexpected — in somebody else's repository, which is why this check is in
 * the gate rather than in a document somebody remembers to follow.
 *
 * It installs into a throwaway directory and removes it either way. Nothing
 * here needs git, a network, or anything beyond bash and bun: an install
 * into a bare `mktemp -d` is a legitimate install, which is what makes this
 * runnable on a CI runner unchanged.
 *
 * Exit codes: 0 the stamp matches, 1 drift, 2 nothing installed to compare.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const packageRoot = resolve(dirname(new URL(import.meta.url).pathname), '..')

const run = (command: string, args: readonly string[], cwd: string): number => {
  const completed = spawnSync(command, [...args], { cwd, stdio: 'inherit' })
  return completed.status ?? 1
}

const main = (): number => {
  const probe = mkdtempSync(join(tmpdir(), 'crust-check-install-'))
  try {
    const installed = run(
      'bun',
      [join(packageRoot, 'scripts', 'install.ts')],
      probe,
    )
    if (installed !== 0) {
      process.stderr.write(
        `check-install: install.ts exited ${installed} — nothing to compare\n`,
      )
      return installed
    }
    return run(
      join(packageRoot, 'scripts', 'verify-install.sh'),
      [probe],
      packageRoot,
    )
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  process.exit(main())
}
