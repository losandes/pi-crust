#!/usr/bin/env bun
/**
 * install — stamp the pi-crust factory from the skill into the cwd. Idempotent.
 *
 * Usage:
 *     bun <pi-crust>/scripts/install.ts [--force]
 *
 * Stamps: .pi-crust/ (modules, stages, lifecycles, config, prompts, recipes, README),
 * .env.pi-crust.sample, .gitignore entries, and a `mod crust` line in the root
 * justfile.
 * Existing files are skipped unless --force.
 */

import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
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
 * The stamp is generated, so none of it is committed by default.
 *
 * Listing the runtime paths one at a time meant a new one had to be added
 * here before it could be ignored, and a path nobody remembered to add got
 * committed silently. Ignoring the directory and re-including what a team
 * must share inverts that: a new runtime path is ignored the day it is
 * written, and anything committed has to be named.
 *
 * Two things are named. The roster, because it is the agreement about which
 * agents run. And `crust.just`, because the installer appends a `mod crust`
 * line to the root justfile, and a `mod` pointing at a missing file fails
 * EVERY `just` invocation in the repository, not only `just crust` — so
 * ignoring it would break an unrelated recipe for anyone who cloned before
 * installing.
 *
 * Nothing else is re-included, including `prompt-engineering/` and
 * `harness-engineering/`. A developer who customises those can un-ignore
 * them; presuming they want to is how a generated tree becomes a tree
 * nobody dares regenerate.
 *
 * The negation works because `.pi-crust/` itself is not excluded, only its
 * children. Git cannot re-include a path whose parent directory is excluded,
 * so `.pi-crust/` and `.pi-crust/*` are not interchangeable here.
 *
 * One developer's overrides of the committed roster are ignored by pattern
 * rather than by exact name, so the rule still covers a config pointed
 * somewhere else.
 */
const GITIGNORE_ENTRIES = [
  '.pi-crust/*',
  '!.pi-crust/crust.just',
  '!.pi-crust/config/',
  '.pi-crust/config/*.local.yaml',
]

const JUST_MODULE = "mod crust '.pi-crust/crust.just'"

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
  appendFileSync(gitignore, `\n# crust runtime\n${missing.join('\n')}\n`, 'utf8')
  tally.stamped.push(`${gitignore} (+${missing.length} entries)`)
}

/**
 * The recipes are part of the operating experience, and the run banner points
 * at them — so a stamped repo has to reach them. They go in `.pi-crust/crust.just`
 * and are imported as a MODULE rather than written into the root justfile:
 * most repositories already have one, and `demo`, `plan`, and `scout` are
 * common enough recipe names that merging would collide.
 */
const ensureJustModule = (root: string, tally: TTally): void => {
  const justfile = join(root, 'justfile')
  const existing = existsSync(justfile) ? readFileSync(justfile, 'utf8') : ''
  /*
   * A COMMENT naming the line is not the line. A justfile that explains how to
   * re-add the module — which is exactly what a repo left after uninstalling
   * tends to have — contains the text without importing anything, and a
   * substring check reads that as "already installed" and silently stamps
   * nothing. Match a real, uncommented statement.
   */
  const installed = existing
    .split('\n')
    .some((line) => line.trim() === JUST_MODULE)
  if (installed) {
    return
  }
  if (existing === '') {
    writeFileSync(
      justfile,
      `# Repo recipes. pi-crust's live in .pi-crust/crust.just — run them as \`just crust <recipe>\`.\n\n${JUST_MODULE}\n`,
      'utf8',
    )
    tally.stamped.push(`${justfile} (created, +crust module)`)
    return
  }
  appendFileSync(
    justfile,
    `\n# crust recipes — run them as \`just crust <recipe>\`\n${JUST_MODULE}\n`,
    'utf8',
  )
  tally.stamped.push(`${justfile} (+crust module)`)
}

const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const main = (): number => {
  const force = process.argv.includes('--force')
  const root = process.cwd()
  const tally: TTally = { stamped: [], skipped: [] }

  stamp(join(TEMPLATES, 'pi-crust'), join(root, '.pi-crust'), force, tally)
  // Namespaced rather than `.env.sample`: the root of somebody else's
  // repository is not ours to claim, and a project with its own sample would
  // otherwise have it overwritten by an install.
  stamp(
    join(TEMPLATES, 'env.sample'),
    join(root, '.env.pi-crust.sample'),
    force,
    tally,
  )
  ensureGitignore(root, tally)
  ensureJustModule(root, tally)
  recordHome(root, tally)

  // The stamped tree has exactly one runtime dependency. Installing it here
  // means `just crust demo` works without a second instruction nobody read.
  const installed = spawnSync('bun', ['install'], {
    cwd: join(root, '.pi-crust'),
    encoding: 'utf8',
  })

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
  say(
    installed.status === 0
      ? '  dependencies: bun install ok'
      : `  dependencies: bun install failed — run it yourself in .pi-crust/ (${(installed.stderr ?? '').trim().slice(-200)})`,
  )
  say('\nnext steps:')
  say(
    '  1. cp .env.pi-crust.sample .env     # then set the key(s) your roster needs',
  )
  say('  2. just crust demo          # two cheap read-only runs, end to end')
  say('  3. just crust sessions      # what just happened')
  say('  4. just crust observe       # the trace UI, needs bun')
  say('\n  no just? the raw form of step 2 is:')
  say('     bun .pi-crust/stages/prompt.ts "say hello" --agent scout')
  say(
    '\n  read .pi-crust/README.md — it explains the folder to whoever finds it next.',
  )
  return 0
}

if (import.meta.main) {
  process.exit(main())
}
