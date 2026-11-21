#!/usr/bin/env bun
/**
 * install — stamp the pi-crust factory from the skill into the cwd. Idempotent.
 *
 * Usage:
 *     bun <pi-crust>/scripts/install.ts [--refresh]
 *
 * Stamps .pi-crust/ config and prompt documents, .env.pi-crust.example,
 * .gitignore entries, and a `crust` passthrough recipe in the root justfile.
 * Existing template-owned files are skipped unless --refresh. --force is a
 * deprecated alias through 0.1.x; remove it in 0.2.0.
 * A missing config/ is seeded once. Once it exists, non-.example.yaml files
 * are neither added nor overwritten; examples are added and may be refreshed.
 * The report separates existing files, repo-owned config, and new examples.
 */

import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const TEMPLATES = resolve(
  dirname(new URL(import.meta.url).pathname),
  '..',
  'templates',
)

/**
 * What a team does not share.
 *
 * Everything else in the stamp IS the team's: the roster, the lifecycles,
 * the themes, and any prompt they wrote. The runtime that reads them lives
 * in the pi-crust package rather than here, so there is no generated code in
 * the stamp to decide about.
 *
 * `data/` is one developer's runs and the machine-local path to pi-crust.
 * A `.local.yaml` is one developer's deviation from the team's answer. The
 * example prompt is illustrative, so it is ignored rather than maintained.
 */
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

const GITIGNORE_ENTRIES = [
  '.pi-crust/data/',
  '.pi-crust/config/*.local.yaml',
  '.pi-crust/prompts/example/',
]

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

/**
 * The recipe body: resolve the package home through CRUST_HOME, this tree's
 * own stamp pointer, then the pointer beside the shared git directory every
 * worktree of one clone names through `git rev-parse --git-common-dir`
 * (1.6.1–1.6.4) — so a linked worktree that was never re-stamped still
 * runs `just crust ...`. Mirrors the chain `crust.just`'s own `crust`
 * variable resolves.
 */
const HOME_RESOLUTION_BODY = [
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
 * answer down. Under `data/`, because it describes this machine rather than
 * this repository: it is gitignored, and the drift check already treats
 * `data/` as runtime rather than as something the skill ships.
 */
const HOME_FILENAME = join('data', 'pi-crust-home')

const recordHome = (root: string): TTally => {
  const home = resolve(dirname(new URL(import.meta.url).pathname), '..')
  const path = join(root, '.pi-crust', HOME_FILENAME)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${home}\n`, 'utf8')
  return tallyOf('stamped', `${path} (${home})`)
}

/** Never stamped into a target repo: the skill's own tests and its installs. */
const isSkipped = (name: string): boolean =>
  name === 'node_modules' || name.endsWith('.test.ts')

type TTally = Readonly<{
  stamped: readonly string[]
  skipped: readonly string[]
  repoOwned: readonly string[]
  configAdded: readonly string[]
}>

const EMPTY_TALLY: TTally = {
  stamped: [],
  skipped: [],
  repoOwned: [],
  configAdded: [],
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
      repoOwned: [...merged.repoOwned, ...next.repoOwned],
      configAdded: [...merged.configAdded, ...next.configAdded],
    }),
    EMPTY_TALLY,
  )

const stamp =
  (refresh: boolean, configExists: boolean) =>
  (source: string, destination: string): TTally => {
    if (isSkipped(source.split('/').at(-1) ?? '')) {
      return EMPTY_TALLY
    }
    if (statSync(source).isDirectory()) {
      return mergeTally(
        readdirSync(source)
          .toSorted()
          .map((child) =>
            stamp(refresh, configExists)(
              join(source, child),
              join(destination, child),
            ),
          ),
      )
    }
    /*
     * An existing config/ belongs to the repository, including filenames it
     * has not adopted. Only .example.yaml documentation is template-owned:
     * add new examples, but refresh existing ones only when requested.
     */
    const inConfig = destination.includes('/.pi-crust/config/')
    if (configExists && inConfig && !destination.endsWith('.example.yaml')) {
      return tallyOf('repoOwned', destination)
    }
    const exists = existsSync(destination)
    if (exists && !refresh) {
      return tallyOf('skipped', destination)
    }
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(source, destination)
    return tallyOf(
      configExists && inConfig && !exists ? 'configAdded' : 'stamped',
      destination,
    )
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
  const target = `    ${NEW_PASSTHROUGH}`
  if (!existing.includes(target)) {
    return EMPTY_TALLY
  }
  const repaired = existing.replace(target, HOME_RESOLUTION_BODY)
  writeFileSync(justfile, repaired, 'utf8')
  return tallyOf(
    'stamped',
    `${justfile} (crust recipe repaired: package home now resolves through ` +
      'CRUST_HOME, the stamp pointer, and the shared git directory)',
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
  // Capture ownership before stamping: creating config/ during a fresh
  // install must not prevent the remaining initial settings from landing.
  const stampFile = stamp(
    refresh,
    existsSync(join(root, '.pi-crust', 'config')),
  )
  const tally = mergeTally([
    stampFile(join(TEMPLATES, 'stamp'), join(root, '.pi-crust')),
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
    recordHome(root),
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
  if (tally.configAdded.length > 0) {
    say(
      `  added to config/ (new since your install): ${tally.configAdded.length} file(s)`,
    )
    for (const path of tally.configAdded) {
      say(`    + ${path}`)
    }
  }
  if (tally.skipped.length > 0) {
    say(
      `  skipped (exists): ${tally.skipped.length} file(s) — use --refresh to replace template-owned files`,
    )
    for (const path of tally.skipped) {
      say(`    = ${path}`)
    }
  }
  say(
    '  config/ is repo-owned: non-.example.yaml files are neither added nor overwritten once config/ exists, even with --refresh.',
  )
  say(`  left to the repository (config/): ${tally.repoOwned.length} file(s)`)
  for (const path of tally.repoOwned) {
    say(`    = ${path}`)
  }
  say('\nnext steps:')
  say(
    '  1. cp .env.pi-crust.example .env     # then set the key(s) your roster needs',
  )
  say('  2. just crust demo          # two cheap read-only runs, end to end')
  say('  3. just crust sessions      # what just happened')
  say('  4. just crust observe       # the trace UI, needs bun')
  say('\n  no just? the raw form of step 2 is:')
  say(
    '     bun "$(cat .pi-crust/data/pi-crust-home)/runtime/commands/run.ts" \\\n' +
      '       "list the top-level directories in this repo" --activities scout',
  )
  say('\n  read .pi-crust/prompts/README.md — it explains what is yours here.')
  return 0
}

if (import.meta.main) {
  process.exit(main())
}
