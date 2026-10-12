#!/usr/bin/env bun
/**
 * install — stamp the pi-crust factory from the skill into the cwd. Idempotent.
 *
 * Usage:
 *     bun <pi-crust>/scripts/install.ts [--force]
 *
 * Stamps: .pi-crust/ (modules, stages, lifecycles, config, prompts, recipes, README),
 * .env.pi-crust.example, .gitignore entries, and a `mod crust` line in the root
 * justfile.
 * Existing files are skipped unless --force.
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

const removeOrphans = (root: string, tally: TTally): void => {
  const gone = ORPHANED.filter((name) => {
    const path = join(root, '.pi-crust', name)
    if (!existsSync(path)) {
      return false
    }
    rmSync(path, { recursive: true, force: true })

    return true
  })
  if (gone.length > 0) {
    tally.stamped.push(
      `removed ${gone.length} path(s) the runtime no longer owns`,
    )
  }
}

const GITIGNORE_ENTRIES = [
  '.pi-crust/data/',
  '.pi-crust/config/*.local.yaml',
  '.pi-crust/prompt-engineering/example/',
]

const JUST_RECIPE = [
  '# pi-crust: every recipe lives in the package, not in this repository.',
  '# `just crust <recipe>` reaches them; `just crust default` lists them.',
  'crust *ARGS:',
  '    @bun "$(cat .pi-crust/data/pi-crust-home)/runtime/cli.ts" {{ARGS}}',
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

const recordHome = (root: string, tally: TTally): void => {
  const home = resolve(dirname(new URL(import.meta.url).pathname), '..')
  const path = join(root, '.pi-crust', HOME_FILENAME)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${home}\n`, 'utf8')
  tally.stamped.push(`${path} (${home})`)
}

/** Never stamped into a target repo: the skill's own tests and its installs. */
const isSkipped = (name: string): boolean =>
  name === 'node_modules' || name.endsWith('.test.ts')

type TTally = { readonly stamped: string[]; readonly skipped: string[] }

const stamp = (
  source: string,
  destination: string,
  force: boolean,
  tally: TTally,
): void => {
  if (isSkipped(source.split('/').at(-1) ?? '')) {
    return
  }
  if (statSync(source).isDirectory()) {
    for (const child of readdirSync(source).toSorted()) {
      stamp(join(source, child), join(destination, child), force, tally)
    }
    return
  }
  /*
   * The roster is the repository's, not the template's.
   *
   * `--force` exists to bring a stamped factory back in line with the skill
   * after an upgrade, and everything under .pi-crust/ is replaceable for that
   * reason — except config/, which holds the models, the writes boundaries and
   * the routing a developer tuned by hand. Overwriting that is not an upgrade,
   * it is deleting someone's work with a flag whose name promised the
   * opposite. verify-install already treats config/ as repo-owned; this makes
   * the installer agree.
   */
  /*
   * ...except the example, which is DOCUMENTATION rather than tuning.
   *
   * Nothing reads it, nobody edits it in place, and it describes keys that
   * change as the factory changes — so a copy frozen at whatever shipped
   * first would quietly start lying. `--force` refreshes it like any other
   * file the skill owns.
   */
  const isExample = destination.endsWith('.example.yaml')
  const repoOwned = destination.includes('/.pi-crust/config/') && !isExample
  if (existsSync(destination) && (!force || repoOwned)) {
    tally.skipped.push(destination)
    return
  }
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
  tally.stamped.push(destination)
}

const ensureGitignore = (root: string, tally: TTally): void => {
  const gitignore = join(root, '.gitignore')
  const existing = existsSync(gitignore)
    ? readFileSync(gitignore, 'utf8').split('\n')
    : []
  const missing = GITIGNORE_ENTRIES.filter((entry) => !existing.includes(entry))
  if (missing.length === 0) {
    return
  }
  appendFileSync(
    gitignore,
    `\n# crust runtime\n${missing.join('\n')}\n`,
    'utf8',
  )
  tally.stamped.push(`${gitignore} (+${missing.length} entries)`)
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
const ensureJustRecipe = (root: string, tally: TTally): void => {
  const justfile = join(root, 'justfile')
  const existing = existsSync(justfile) ? readFileSync(justfile, 'utf8') : ''
  /*
   * A COMMENT naming the recipe is not the recipe. A justfile that explains
   * how to re-add it — which is what a repo left after uninstalling tends to
   * have — contains the text without defining anything, and a substring check
   * reads that as "already installed" and silently stamps nothing. Match a
   * real, uncommented recipe header.
   */
  const installed = existing
    .split('\n')
    .some((line) => line.trim() === 'crust *ARGS:')
  if (installed) {
    return
  }
  if (existing === '') {
    writeFileSync(justfile, `${JUST_RECIPE}\n`, 'utf8')
    tally.stamped.push(`${justfile} (created, +crust recipe)`)
    return
  }
  appendFileSync(justfile, `\n${JUST_RECIPE}\n`, 'utf8')
  tally.stamped.push(`${justfile} (+crust recipe)`)
}

const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const main = (): number => {
  const force = process.argv.includes('--force')
  const root = process.cwd()
  const tally: TTally = { stamped: [], skipped: [] }

  stamp(join(TEMPLATES, 'stamp'), join(root, '.pi-crust'), force, tally)
  // Namespaced rather than `.env.example`: the root of somebody else's
  // repository is not ours to claim, and a project with its own example would
  // otherwise have it overwritten by an install.
  stamp(
    join(TEMPLATES, 'env.example'),
    join(root, '.env.pi-crust.example'),
    force,
    tally,
  )
  removeOrphans(root, tally)
  ensureGitignore(root, tally)
  ensureJustRecipe(root, tally)
  recordHome(root, tally)

  say(`crust installed into ${root}`)
  say(`  stamped: ${tally.stamped.length} file(s)`)
  for (const path of tally.stamped) {
    say(`    + ${path}`)
  }
  if (tally.skipped.length > 0) {
    say(
      `  skipped (already exist, use --force to overwrite): ${tally.skipped.length}`,
    )
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
    '     bun "$(cat .pi-crust/data/pi-crust-home)/runtime/lifecycles/compose.ts" "list the top-level directories in this repo" --steps scout',
  )
  say(
    '\n  read .pi-crust/prompt-engineering/README.md — it explains what is yours here.',
  )
  return 0
}

if (import.meta.main) {
  process.exit(main())
}
