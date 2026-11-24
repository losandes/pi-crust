#!/usr/bin/env bun
/**
 * install — set pi-crust up in the cwd. Idempotent.
 *
 * Usage:
 *     crust init [--refresh]
 *     crust update
 *
 * Writes pi-crust.toml once, the credential example and a data ignore entry.
 * Writes no justfile and no machine record, and leaves existing ones untouched.
 * --refresh replaces template-owned files, never the repository TOML file.
 * --force is a deprecated alias through 0.1.x; remove it in 0.2.0.
 * Legacy configuration and prompt directories are left untouched.
 */

import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const TEMPLATES = resolve(
  dirname(new URL(import.meta.url).pathname),
  '..',
  'templates',
)

/**
 * Paths the stamp used to own, removed when an install finds them.
 *
 * Earlier versions stamped the whole runtime into `.pi-crust/`. Those copies
 * are now dead weight that no code reads, and leaving them means somebody
 * edits one and wonders why nothing changed.
 *
 * The list is explicit rather than "anything not in the template". A team's
 * own file must never be a deletion candidate, and a rule phrased as an
 * exclusion makes every new file one until somebody remembers to exempt it.
 */
const ORPHANED = [
  'modules',
  'stages',
  'lifecycles',
  'harness-engineering',
  'crust.just',
  'package.json',
  'tsconfig.json',
  'bun.lock',
  'node_modules',
  'README.md',
  'consult.ts',
  'decide.ts',
  'please.ts',
  'prune.ts',
  'report.ts',
  'steer.ts',
  'workspaces.ts',
]

const removeOrphans = (root: string): TTally => {
  const gone = ORPHANED.filter((name) => {
    const path = join(root, '.pi-crust', name)
    if (!existsSync(path)) {
      return false
    }
    rmSync(path, { recursive: true, force: true })

    return true
  })
  return gone.length > 0
    ? tallyOf(
        'stamped',
        `removed ${gone.length} path(s) the runtime no longer owns`,
      )
    : EMPTY_TALLY
}

const GITIGNORE_ENTRIES = ['.pi-crust/data/']

type TTally = Readonly<{
  stamped: readonly string[]
  skipped: readonly string[]
}>

const EMPTY_TALLY: TTally = {
  stamped: [],
  skipped: [],
}

/** One entry, as a `TTally` ready to merge \u2014 the unit every helper below returns. */
const tallyOf = (kind: keyof TTally, entry: string): TTally => ({
  ...EMPTY_TALLY,
  [kind]: [entry],
})

/** Combine tallies in the order they happened, which is the order they are reported in. */
const mergeTally = (tallies: readonly TTally[]): TTally =>
  tallies.reduce(
    (merged, next) => ({
      stamped: [...merged.stamped, ...next.stamped],
      skipped: [...merged.skipped, ...next.skipped],
    }),
    EMPTY_TALLY,
  )

const stamp =
  (refresh: boolean) =>
  (source: string, destination: string): TTally => {
    if (existsSync(destination) && !refresh)
      return tallyOf('skipped', destination)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(source, destination)
    return tallyOf('stamped', destination)
  }

const ensureGitignore = (root: string): TTally => {
  const gitignore = join(root, '.gitignore')
  const existing = existsSync(gitignore)
    ? readFileSync(gitignore, 'utf8').split('\n')
    : []
  const missing = GITIGNORE_ENTRIES.filter((entry) => !existing.includes(entry))
  if (missing.length === 0) {
    return EMPTY_TALLY
  }
  appendFileSync(
    gitignore,
    `\n# crust runtime\n${missing.join('\n')}\n`,
    'utf8',
  )
  return tallyOf('stamped', `${gitignore} (+${missing.length} entries)`)
}

const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const main = (): number => {
  const deprecatedForce = process.argv.includes('--force')
  const refresh = process.argv.includes('--refresh') || deprecatedForce
  const root = process.cwd()
  const stampFile = stamp(refresh)
  const tally = mergeTally([
    stamp(false)(join(TEMPLATES, 'pi-crust.toml'), join(root, 'pi-crust.toml')),
    // Namespaced rather than `.env.example`: the root of somebody else's
    // repository is not ours to claim, and a project with its own example
    // would otherwise have it overwritten by an install.
    stampFile(
      join(TEMPLATES, 'env.example'),
      join(root, '.env.pi-crust.example'),
    ),
    removeOrphans(root),
    ensureGitignore(root),
  ])

  say(`crust installed into ${root}`)
  if (deprecatedForce) {
    say(
      '  --force is deprecated; use --refresh (alias supported through 0.1.x).',
    )
  }
  say(`  stamped: ${tally.stamped.length} file(s)`)
  for (const path of tally.stamped) {
    say(`    + ${path}`)
  }
  if (tally.skipped.length > 0) {
    say(
      `  skipped (exists): ${tally.skipped.length} file(s) — use --refresh to replace template-owned files`,
    )
    for (const path of tally.skipped) {
      say(`    = ${path}`)
    }
  }
  for (const name of ['config', 'prompts']) {
    const path = join(root, '.pi-crust', name)
    if (existsSync(path))
      say(
        `  ${path}: no longer read, left untouched. Migrate by hand; see <pi-crust>/references/config.md.`,
      )
  }
  const legacyPointer = join(root, '.pi-crust', 'data', 'pi-crust-home')
  if (existsSync(legacyPointer))
    say(`  ${legacyPointer}: no longer read, left untouched.`)
  say('\nnext steps:')
  say(
    '  1. cp .env.pi-crust.example .env     # then set the key(s) your roster needs',
  )
  say('  2. crust demo          # two cheap read-only runs, end to end')
  say('  3. crust sessions      # what just happened')
  say('  4. crust observe       # the trace UI, needs bun')
  say(
    '\n  read <pi-crust>/references/config.md for the three TOML configuration layers.',
  )
  return 0
}

if (import.meta.main) {
  process.exit(main())
}
