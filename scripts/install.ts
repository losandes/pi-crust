#!/usr/bin/env bun
/**
 * install — stamp the pi-crust factory from the skill into the cwd. Idempotent.
 *
 * Usage:
 *     bun <pi-crust>/scripts/install.ts [--refresh]
 *
 * Writes pi-crust.toml once, the credential example, a data ignore entry,
 * the package-home pointer and the root justfile passthrough recipe.
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
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
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

/**
 * The setting that keeps a prompt one argument.
 *
 * `{{ARGS}}` interpolates a variadic parameter into the command line as
 * TEXT, so the shell splits it again on whitespace: `just crust run "add a
 * src directory"` reached the runtime as six arguments, the first of which
 * became the whole prompt. The run then did real work on the word "add".
 *
 * `set positional-arguments` plus `"$@"` is the only mechanism just has for
 * passing arguments through with their boundaries intact. It is file-scoped
 * rather than recipe-scoped, which is a real imposition on a repository's own
 * justfile and is accepted because the alternative is a factory that silently
 * truncates every prompt containing a space.
 */
const JUST_SETTING = 'set positional-arguments'

/** Earlier recipe body retained only for exact-match upgrade repair. */
const LEGACY_HOME_RESOLUTION_BODY = [
  '    #!/usr/bin/env bash',
  '    set -euo pipefail',
  // A template literal with the dollar escaped, so what reaches the file is
  // the bash parameter expansion `${CRUST_HOME:-}` and nothing here reads as
  // a JavaScript placeholder written in the wrong quotes.
  `    home="\${CRUST_HOME:-}"`,
  '    if [[ -z "$home" && -f .pi-crust/data/pi-crust-home ]]; then',
  '      home="$(cat .pi-crust/data/pi-crust-home)"',
  '    fi',
  '    if [[ -z "$home" ]]; then',
  '      common="$(git rev-parse --git-common-dir 2>/dev/null || true)"',
  '      if [[ -n "$common" ]]; then',
  '        root="$(cd "$(dirname "$common")" && pwd)"',
  '        if [[ -f "$root/.pi-crust/data/pi-crust-home" ]]; then',
  '          home="$(cat "$root/.pi-crust/data/pi-crust-home")"',
  '        fi',
  '      fi',
  '    fi',
  '    if [[ -z "$home" ]]; then',
  '      echo "crust: cannot find the package home." >&2',
  '      echo "  checked CRUST_HOME, .pi-crust/data/pi-crust-home, and \\$(git rev-parse --git-common-dir)/../.pi-crust/data/pi-crust-home." >&2',
  '      echo "  set CRUST_HOME to repair it." >&2',
  '      exit 2',
  '    fi',
  '    exec bun "$home/runtime/cli.ts" "$@"',
].join('\n')

const HOME_RESOLUTION_BODY = [
  '    #!/usr/bin/env bash',
  '    set -euo pipefail',
  `    home="\${CRUST_HOME:-}"`,
  `    pointer="\${HOME}/.pi-crust/pi-crust-home"`,
  '    if [[ -z "$home" && -f "$pointer" ]]; then',
  '      home="$(cat "$pointer")"',
  '    fi',
  '    if [[ -z "$home" ]]; then',
  '      echo "crust: cannot find the package home." >&2',
  '      echo "  looked at CRUST_HOME (not set) and $pointer (not found)." >&2',
  '      echo "  repair: run \'bun <pi-crust>/scripts/install.ts\' in this repository, or set CRUST_HOME to the pi-crust directory." >&2',
  '      exit 2',
  '    fi',
  '    exec bun "$home/runtime/cli.ts" "$@"',
].join('\n')

const JUST_RECIPE = [
  '# pi-crust: every recipe lives in the package, not in this repository.',
  '# `just crust <recipe>` reaches them; `just crust default` lists them.',
  '#',
  '# `set positional-arguments` + "$@" rather than {{ARGS}}: interpolation',
  '# re-splits on whitespace, which turns a quoted prompt into one word.',
  JUST_SETTING,
  '',
  'crust *ARGS:',
  HOME_RESOLUTION_BODY,
].join('\n')

/** The same block, for a justfile that already carries the setting. */
const JUST_RECIPE_ONLY = [
  '# pi-crust: every recipe lives in the package, not in this repository.',
  '# `just crust <recipe>` reaches them; `just crust default` lists them.',
  '#',
  "# Relies on this file's `set positional-arguments`: without it, {{ARGS}}",
  '# interpolation re-splits a quoted prompt on whitespace.',
  'crust *ARGS:',
  HOME_RESOLUTION_BODY,
].join('\n')

/**
 * Where pi-crust was installed from, left behind for the recipes to find.
 *
 * `observe` boots a web app that lives in the pi-crust package rather than in
 * the stamp, so something has to answer "where is that". Discovering it is
 * not possible from inside a stamped tree — the package may be a sibling
 * checkout, a global install, or a node_modules directory — and asking the
 * developer to export a variable means `observe` fails for everyone who did
 * not read the install output.
 *
 * The installer is the one process that knows the answer, so it writes the
 * answer down once under the user's machine home, outside every repository.
 */
const HOME_FILENAME = 'pi-crust-home'

const recordHome = (): TTally => {
  const home = resolve(dirname(new URL(import.meta.url).pathname), '..')
  const path = join(process.env.HOME ?? homedir(), '.pi-crust', HOME_FILENAME)
  const previous = existsSync(path) ? readFileSync(path, 'utf8').trim() : ''
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${home}\n`, 'utf8')
  return tallyOf(
    'stamped',
    `${path} (${home})${previous !== '' && previous !== home ? ` was ${previous}` : ''}`,
  )
}

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

/**
 * The recipes are part of the operating experience, and the run banner points
 * at them — so a stamped repo has to reach them.
 *
 * One passthrough recipe rather than a `mod` line. The recipes live in the
 * pi-crust package, whose path differs per machine and must not be committed,
 * and a `mod` resolves its path when the justfile is PARSED — so a missing
 * one fails every recipe in the repository, not only the crust ones. A
 * passthrough resolves at call time and costs an unrelated recipe nothing.
 */
/**
 * An ALREADY-STAMPED justfile whose passthrough still interpolates.
 *
 * The first version of this recipe ended `{{ARGS}}`, which the shell splits
 * again on whitespace — so every prompt containing a space arrived as its
 * first word and runs were started on "add". A repository that has the old
 * line gets it corrected on the next install; one that has already been
 * corrected, or that a team has edited, is left alone.
 *
 * This is the one case where an install rewrites a line the repository owns.
 * It is narrow by construction: the exact old body, replaced by the exact new
 * one, and the setting added only when the file lacks it.
 */
const OLD_PASSTHROUGH =
  '@bun "$(cat .pi-crust/data/pi-crust-home)/runtime/cli.ts" {{ARGS}}'

const NEW_PASSTHROUGH =
  '@bun "$(cat .pi-crust/data/pi-crust-home)/runtime/cli.ts" "$@"'

const repairInterpolation = (justfile: string, existing: string): TTally => {
  if (!existing.includes(OLD_PASSTHROUGH)) {
    return EMPTY_TALLY
  }
  const settled = existing
    .split('\n')
    .map((line) => line.trim())
    .some((line) => line === JUST_SETTING || line === `${JUST_SETTING} := true`)
  const repaired = existing.replace(OLD_PASSTHROUGH, NEW_PASSTHROUGH)
  writeFileSync(
    justfile,
    settled ? repaired : `${JUST_SETTING}\n\n${repaired}`,
    'utf8',
  )
  return tallyOf(
    'stamped',
    `${justfile} (crust recipe repaired: a quoted prompt stayed one word)`,
  )
}

/**
 * A repository whose `crust` recipe still reads ONE path — `NEW_PASSTHROUGH`
 * above, the form every stamp carried before this chain existed. A linked
 * worktree with no pointer of its own cannot run it (1.6.1–1.6.4), so a
 * re-stamp replaces the single line with the resolving body (1.6.3), the
 * same way `repairInterpolation` replaces the `{{ARGS}}` body today.
 */
const repairHomeResolution = (justfile: string, existing: string): TTally => {
  const match = /^crust \*ARGS:\n((?:[ \t].*(?:\n|$))+)/m.exec(existing)
  const body = match?.[1]?.replace(/\n$/, '')
  if (body !== `    ${NEW_PASSTHROUGH}` && body !== LEGACY_HOME_RESOLUTION_BODY)
    return EMPTY_TALLY
  const repaired = existing.replace(
    `crust *ARGS:\n${body}`,
    `crust *ARGS:\n${HOME_RESOLUTION_BODY}`,
  )
  writeFileSync(justfile, repaired, 'utf8')
  return tallyOf(
    'stamped',
    `${justfile} (crust recipe repaired: package home now resolves through ` +
      'CRUST_HOME or the machine record)',
  )
}

const ensureJustRecipe = (root: string): TTally => {
  const justfile = join(root, 'justfile')
  const existing = existsSync(justfile) ? readFileSync(justfile, 'utf8') : ''
  /*
   * A COMMENT naming the recipe is not the recipe. A justfile that explains
   * how to re-add it — which is what a repo left after uninstalling tends to
   * have — contains the text without defining anything, and a substring check
   * reads that as "already installed" and silently stamps nothing. Match a
   * real, uncommented recipe header.
   */
  const lines = existing.split('\n').map((line) => line.trim())
  const installed = lines.some((line) => line === 'crust *ARGS:')
  if (installed) {
    const afterInterpolation = repairInterpolation(justfile, existing)
    const current = existsSync(justfile)
      ? readFileSync(justfile, 'utf8')
      : existing
    return mergeTally([
      afterInterpolation,
      repairHomeResolution(justfile, current),
    ])
  }
  if (existing === '') {
    writeFileSync(justfile, `${JUST_RECIPE}\n`, 'utf8')
    return tallyOf('stamped', `${justfile} (created, +crust recipe)`)
  }
  /*
   * A second `set positional-arguments` is a parse error, so a justfile that
   * already has it gets the recipe alone. The setting is file-scoped and
   * order does not matter, which is why appending works at all.
   */
  const settled = lines.some(
    (line) => line === JUST_SETTING || line === `${JUST_SETTING} := true`,
  )
  const block = settled ? JUST_RECIPE_ONLY : JUST_RECIPE
  appendFileSync(justfile, `\n${block}\n`, 'utf8')
  return tallyOf(
    'stamped',
    `${justfile} (+crust recipe${settled ? '' : ', +positional-arguments'})`,
  )
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
    ensureJustRecipe(root),
    recordHome(),
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
    say(
      `  ${legacyPointer}: no longer read, left untouched. pi-crust is found through CRUST_HOME or ${join(process.env.HOME ?? homedir(), '.pi-crust', HOME_FILENAME)}.`,
    )
  say('\nnext steps:')
  say(
    '  1. cp .env.pi-crust.example .env     # then set the key(s) your roster needs',
  )
  say('  2. just crust demo          # two cheap read-only runs, end to end')
  say('  3. just crust sessions      # what just happened')
  say('  4. just crust observe       # the trace UI, needs bun')
  say('\n  no just? the raw form of step 2 is:')
  say(
    '     bun "$(cat ~/.pi-crust/pi-crust-home)/runtime/commands/run.ts" \\\n' +
      '       "list the top-level directories in this repo" --activities scout',
  )
  say(
    '\n  read <pi-crust>/references/config.md for the three TOML configuration layers.',
  )
  return 0
}

if (import.meta.main) {
  process.exit(main())
}
