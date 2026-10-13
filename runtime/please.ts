#!/usr/bin/env bun

/**
 * `just crust please` — the command builder.
 *
 * Every flag this assembles can be typed by hand, and once you know them you
 * will. The problem is the cost of a half-remembered one: a lifecycle, a trust
 * level, a delivery mode and an approval point is four decisions, and getting
 * one wrong is a run you kill five minutes in. A menu makes each decision
 * visible with its options and their consequences beside it.
 *
 * It asks for a run id FIRST, because that question subsumes all the others:
 * naming a run means you are continuing one, and nothing else needs asking.
 *
 * It shows the assembled command before running it. The wizard is a way to
 * build a command, not a replacement for knowing them — seeing the line you
 * just described is how the flags become memorable.
 *
 *     just crust please
 */

import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { askMenuChoice, askOne, askOrder, askText } from './modules/data/ask'
import { copyToClipboard } from './modules/data/clipboard'
import { configPathFromEnv, dbPathFromEnv } from './modules/data/env-overrides'
import { box, paint, writeLine } from './modules/data/terminal'
import { DEFAULT_CONFIG_PATH } from './modules/typedefs/config'
import { TRUST_DEFAULT } from './modules/typedefs/trust'
import {
  resumeArgvFor,
  runArgv,
  TRUST_CHOICES,
} from './modules/use-cases/compose-request'
import { displayLabel } from './modules/use-cases/run-label'
import { shellLine } from './modules/use-cases/recipe-line'
import { loadConfig } from './modules/use-cases/load-config'
import {
  lifecyclesBeside,
  loadLifecycles,
} from './modules/use-cases/load-lifecycles'
import {
  chosenLifecycle,
  chosenPlanner,
  exclusiveCount,
  expandChoices,
  menuOptions,
} from './modules/use-cases/menu-options'

const DEFAULT_DB = '.pi-crust/data/crust.db'

const EXIT = { SUCCESS: 0, CANCELLED: 130 } as const

type TWaiting = Readonly<{
  run_id: string
  lifecycle: string
  status: string
  started_at: string
  name: string | null
}>

/**
 * `name` is a column a tracer ADDS by migration. This query opens the db
 * readonly and never migrates it, so selecting the column unconditionally
 * would throw "no such column: name" against a database an older pi-crust
 * wrote. Probing first and substituting NULL is the same guard the
 * visualizer's `optionalColumn` applies.
 */
const hasNameColumn = (db: Database): boolean =>
  db
    .query<{ name: string }, []>('PRAGMA table_info(sessions)')
    .all()
    .some((row) => row.name === 'name')

/**
 * Runs that are waiting on a person, newest first.
 *
 * Only waiting ones. A menu of every run this repository has ever done is a
 * list to search, not a question to answer — and the only run id worth
 * offering is one where naming it would actually do something.
 */
const waitingRuns = (dbPath: string): readonly TWaiting[] => {
  if (!existsSync(dbPath)) return []
  const db = new Database(dbPath, { readonly: true })
  try {
    const nameColumn = hasNameColumn(db) ? 'name' : 'NULL AS name'
    return db
      .query(
        `SELECT run_id, lifecycle, status, started_at, ${nameColumn} FROM sessions ` +
          "WHERE status='waiting' ORDER BY started_at DESC LIMIT 20",
      )
      .all() as TWaiting[]
  } finally {
    db.close()
  }
}

const NEW_RUN = '\u0000new'

/** Which run, if any. Undefined means they backed out. */
const askWhichRun = async (
  dbPath: string,
): Promise<string | undefined | typeof NEW_RUN> => {
  const waiting = waitingRuns(dbPath)
  if (waiting.length === 0) return NEW_RUN

  const chosen = await askOne('a run is waiting for you. pick one up?', [
    ...waiting.map((run) => ({
      value: run.run_id,
      label: `${run.run_id}  ${displayLabel(run.name ?? '', run.lifecycle)}`,
      detail: `waiting since ${run.started_at}`,
    })),
    { value: NEW_RUN, label: 'start something new', detail: '' },
  ])
  return chosen
}

/** Answering a waiting run. Approve, reject and answer all mean "carry on". */
const planResume = async (
  runId: string,
): Promise<readonly string[] | undefined> => {
  const verb = await askOne(`${runId} is waiting. what are you telling it?`, [
    {
      value: 'approve',
      label: 'approve',
      detail: 'carry on as proposed, with nothing further from me',
    },
    {
      value: 'answer',
      label: 'answer',
      detail: 'I have something to say, and the next stage treats it as fact',
    },
    {
      value: 'reject',
      label: 'reject',
      detail: 'not this — and here is why, which the next stage must honour',
    },
  ])
  if (verb === undefined) return undefined
  if (verb === 'approve') {
    return resumeArgvFor({ runId, verb: 'approve', note: '' })
  }

  const note = await askText(
    verb === 'reject' ? 'why not?' : 'what should it know?',
  )
  if (note === undefined || note === '') {
    writeLine(paint('nothing said — not sending an empty answer.', 'yellow'))
    return undefined
  }
  return resumeArgvFor({
    runId,
    verb: verb === 'reject' ? 'reject' : 'answer',
    note,
  })
}

/*
 * Three kinds of answer, told apart by a prefix the person never sees.
 *
 * `@` a lifecycle, `!` an operator, bare a activity. A prefix rather than three
 * parallel menus because it is ONE question — "what should it do" — and the
 * answer may legitimately be a named chain, a chain chosen for you, or activities
 * you picked yourself.
 */
/** A new run: activities, prompt, trust, delivery, approval point. */
const planNewRun = async (): Promise<readonly string[] | undefined> => {
  /*
   * The config decides what the menu offers and what order a selection runs
   * in. Read here rather than threaded in, because `please` is the only
   * caller and a parameter would exist solely to be passed one level.
   */
  const configPath = configPathFromEnv() ?? DEFAULT_CONFIG_PATH
  const cfg = loadConfig(configPath)
  const lifecycles = loadLifecycles(lifecyclesBeside(configPath), cfg)
  const options = menuOptions(cfg.activities, lifecycles)

  const chosen = await askMenuChoice('what should it do?', options, {
    multiple: true,
    preselected: [0],
    /*
     * Lifecycles and operators are both exclusive, and exclusive with each
     * other: each answers the whole question. A lifecycle names the chain,
     * an operator chooses it, and a list of activities IS one — so any two of
     * them together are two answers where one was asked for. Picking
     * `scout` while `sdlc` was still held once produced a run that did the
     * entire lifecycle and then scouted.
     */
    exclusive: Array.from(
      { length: exclusiveCount(lifecycles) },
      (_, index) => index,
    ),
    preview: (ticked, highlighted) => {
      /*
       * What the cursor is on, when it is not already part of the answer.
       *
       * Scrolling the list is how you find out what a lifecycle contains,
       * and a preview that only updates on selection means ticking things
       * to read them and un-ticking them again.
       */
      const previewing = !ticked.includes(highlighted) && highlighted !== ''
      const shown = previewing ? [highlighted] : ticked

      const operator = chosenPlanner(shown)
      if (operator !== '') {
        const says = `${operator} chooses the chain, then runs it`
        return previewing ? `${says}   (not selected)` : says
      }
      const chain = expandChoices(shown, lifecycles)
      if (chain.length === 0) return 'nothing yet'
      return previewing
        ? `${chain.join(' → ')}   (not selected)`
        : chain.join(' → ')
    },
  })
  const chosenActivities = chosen.values
  if (chosenActivities === undefined) return undefined
  if (chosenActivities.length === 0) {
    writeLine(paint('nothing chosen.', 'yellow'))
    return undefined
  }

  const operator = chosenPlanner(chosenActivities)
  /*
   * Sorted into the configured order, not the order they were ticked.
   *
   * Tick order was the rule before, and it was undiscoverable and
   * inconsistent — `a` for all produced list order from the same screen.
   * Anyone who wants a different sequence says so with `r`, once.
   */
  const defaultOrder = expandChoices(chosenActivities, lifecycles)
  const activities =
    chosen.reorder && operator === ''
      ? ((await askOrder('what order?', defaultOrder)) ?? defaultOrder)
      : defaultOrder

  const prompt = await askText('what is the ask? (a sentence, or a file path)')
  if (prompt === undefined || prompt === '') {
    writeLine(paint('a run needs something to do.', 'yellow'))
    return undefined
  }

  const trust = await askOne(
    'how much should it decide for itself?',
    /*
     * The name, and nothing else. The number is the storage format, not the
     * thing a person is choosing between — and printed here it invited
     * exactly the question it should have answered: whether a number in
     * between would mean something.
     */
    TRUST_CHOICES.map((choice) => ({
      value: String(choice.level),
      label: choice.label,
      detail: choice.detail,
    })),
    // The default, which is now the same 50 the wizard used to special-case.
    TRUST_CHOICES.findIndex((choice) => choice.level === TRUST_DEFAULT),
  )
  if (trust === undefined) return undefined

  /*
   * Delivery is a property of each Activity now, so the only question left
   * is whether this run may commit at all. There is no option to make an
   * Activity commit that did not declare it: a flag granting a permission
   * the registry withheld would make a run nobody could predict from the
   * registry.
   */
  const commit = await askOne('may it commit as it goes?', [
    {
      value: 'yes',
      label: 'yes',
      detail:
        'each committing Activity lands its own change, in its own words, once its gates pass',
    },
    {
      value: 'no',
      label: 'no',
      detail: 'nothing is committed; the work is left in the working tree',
    },
  ])
  if (commit === undefined) return undefined

  /*
   * Not asked when an operator is choosing: its activities do not exist yet, so a
   * menu of them would be a menu of nothing. The operator's own chain gate
   * covers the same ground — below trust 50 it shows you the chain before
   * running a activity of it.
   */
  const approveAfter =
    operator === ''
      ? await askOne('stop and show you, after which activity?', [
          {
            value: '',
            label: 'nowhere extra',
            detail: 'the gates the lifecycle already defines still apply',
          },
          ...activities.map((activity) => ({
            value: activity,
            label: activity,
            detail: '',
          })),
        ])
      : ''
  if (approveAfter === undefined) return undefined

  const stream = await askOne('show its thinking as it goes?', [
    { value: 'yes', label: 'yes', detail: 'narration streams into the trace' },
    { value: 'no', label: 'no', detail: 'quieter; the trace still records it' },
  ])
  if (stream === undefined) return undefined

  return runArgv({
    /*
     * A reordered selection is no longer the Lifecycle it came from, so it
     * is passed as the list it has become. Anything else would run an order
     * the person explicitly changed away from.
     */
    lifecycle: chosen.reorder ? '' : chosenLifecycle(chosenActivities),
    operator,
    activities,
    prompt,
    trustLevel: Number(trust),
    commit: commit === 'yes',
    approveAfter,
    stream: stream === 'yes',
  })
}

export const main = async (): Promise<number> => {
  const dbPath = dbPathFromEnv() ?? DEFAULT_DB

  const which = await askWhichRun(dbPath)
  if (which === undefined) {
    writeLine(paint('nothing started.', 'dim'))
    return EXIT.CANCELLED
  }

  const argv = which === NEW_RUN ? await planNewRun() : await planResume(which)
  if (argv === undefined) {
    writeLine(paint('nothing started.', 'dim'))
    return EXIT.CANCELLED
  }

  /*
   * Shown before it runs, always. The wizard is a way to BUILD a command, not
   * a replacement for knowing them: seeing the line you just described is how
   * the flags stop needing the wizard.
   */
  /*
   * The recipe, which is the only form there is now: nothing composes a path
   * into the stamp any more, because the runtime does not live there.
   */
  const line = shellLine(argv)
  writeLine(box('the command', [line], 'cyan'))

  /*
   * And it is offered rather than run.
   *
   * Half of what `please` is for is finding out what the flags were; that
   * half is finished by the time the line is on screen. Running it anyway
   * would make the builder unusable as a builder — and a run is expensive
   * enough that starting one nobody confirmed is the wrong default.
   */
  const go = await askOne('go?', [
    {
      value: 'run',
      label: 'run it',
      detail: 'starts now, attached to this terminal',
    },
    {
      value: 'print',
      label: 'just give me the line',
      detail: 'copy it, change it, run it yourself',
    },
  ])
  if (go !== 'run') {
    const copied = await copyToClipboard(line)
    writeLine(`\n${line}\n`)
    writeLine(
      copied.copied
        ? paint(`copied to your clipboard (${copied.how})`, 'dim')
        : paint(`${copied.how} — select it above`, 'dim'),
    )
    return EXIT.SUCCESS
  }

  const [command, ...rest] = argv
  const child = Bun.spawn([command ?? 'bun', ...rest], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env },
  })
  return await child.exited
}

if (import.meta.main) {
  /*
   * A wizard that cannot be escaped is a trap. Ctrl-C at any prompt leaves
   * raw mode behind it, so the terminal is usable afterwards.
   */
  const code = await main().catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`)
    return 1
  })
  if (process.stdin.isTTY) process.stdin.setRawMode(false)
  process.exit(code)
}
