#!/usr/bin/env bun
/**
 * The one entry point a stamped repository reaches.
 *
 * `just crust <recipe> [args]` lands here. The recipes themselves live in
 * `crust.just` beside this file, in the pi-crust package rather than in the
 * repository being worked on — so this runs `just` against that file with the
 * caller's directory as the working directory.
 *
 * It exists because `mod` cannot do the job. A justfile module resolves its
 * path when the file is PARSED, so a path that differs per machine either has
 * to be committed, which it must not be, or every recipe in the repository
 * fails when it is absent. Resolving at call time costs an unrelated recipe
 * nothing.
 */

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const recipes = join(here, 'crust.just')

const result = spawnSync(
  'just',
  [
    '--justfile',
    recipes,
    '--working-directory',
    process.cwd(),
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
)

process.exit(result.status ?? 1)
