#!/usr/bin/env bun
/**
 * typecheck-harness — check `runtime/harness-engineering/` against the pi
 * this machine actually runs.
 *
 * Usage:
 *     bun <pi-crust>/scripts/typecheck-harness.ts
 *
 * The extensions in that directory import `@earendil-works/*` and `typebox`,
 * which the pi host supplies to an extension at run time. They are not
 * dependencies of this repository, and declaring them would be worse than
 * leaving them out: npm's latest is 1.3.0 while this machine runs 1.1.0, so a
 * pinned copy would typecheck the extensions against an API no agent here
 * ever meets. pi has renamed these packages once already — `@mariozechner/*`
 * became `@earendil-works/*`, `@sinclair/typebox` became bare `typebox` — and
 * a pin is a promise to notice the next rename by hand.
 *
 * So the host is the target. `piReleaseDir()` finds it the way pi's own
 * launcher does, `harnessProject()` maps the specifiers onto it, and tsc runs
 * against whatever that machine has. No pin to bump, nothing to install, and
 * a rename shows up as a resolution error the moment it lands.
 *
 * A missing host is a SKIPPED check, not a passed one, and the two have to
 * be told apart by whatever is reading the exit code. Interactively that
 * distinction is a line of output somebody reads; in a pipeline nobody reads
 * it, so `CI` or `CRUST_STRICT` turns the skip into a failure. The same
 * script, run the same way, with one variable deciding how loud a gap is.
 *
 * Exit codes: 0 checked clean, or no host found outside strict mode (and
 * said so), 1 type errors or a missing host under CI/CRUST_STRICT.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { piReleaseDir } from '../runtime/modules/data/pi-host'
import { harnessProject } from '../runtime/modules/use-cases/harness-project'

const runtimeDir = resolve(
  dirname(new URL(import.meta.url).pathname),
  '..',
  'runtime',
)

/**
 * Written beside `runtime/tsconfig.json`, because the options it inherits —
 * `types: ["bun"]` among them — resolve relative to the file that declares
 * them. Named so a stray copy is obviously not a file anybody wrote, and
 * removed in a `finally` either way.
 */
const GENERATED = join(runtimeDir, 'tsconfig.harness.generated.json')

const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

/** Is a skipped check allowed to pass here? Not where nobody reads the log. */
const strict = (): boolean => {
  const flag = process.env.CRUST_STRICT ?? process.env.CI ?? ''
  return flag !== '' && flag !== '0' && flag.toLowerCase() !== 'false'
}

const main = (): number => {
  const release = piReleaseDir()
  if (release === undefined) {
    say(
      'typecheck-harness: no managed pi install found, so harness-engineering ' +
        'was NOT checked. Set PI_PATH, or put pi on PATH, to check it.',
    )
    if (strict()) {
      say(
        'typecheck-harness: CI or CRUST_STRICT is set, and a check that did ' +
          'not run does not pass. Install pi on this runner, or unset the ' +
          'variable to accept the gap deliberately.',
      )
      return 1
    }
    return 0
  }

  say(`typecheck-harness: checking against ${release}`)
  writeFileSync(
    GENERATED,
    `${JSON.stringify(harnessProject(join(release, 'node_modules')), undefined, 2)}\n`,
  )
  try {
    const completed = spawnSync(
      'bun',
      ['x', 'tsc', '-p', GENERATED, '--noEmit'],
      { cwd: runtimeDir, stdio: 'inherit' },
    )
    return completed.status ?? 1
  } finally {
    if (existsSync(GENERATED)) {
      rmSync(GENERATED)
    }
  }
}

if (import.meta.main) {
  process.exit(main())
}
