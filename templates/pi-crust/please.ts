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
 *     bun .pi-crust/please.ts
 */

import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { askMenuChoice, askOne, askOrder, askText } from './modules/data/ask'
import { copyToClipboard } from './modules/data/clipboard'
import { configPathFromEnv, dbPathFromEnv } from './modules/data/env-overrides'
import { DEFAULT_CONFIG_PATH } from './modules/typedefs/config'
import { loadConfig } from './modules/use-cases/load-config'
import {
  effectiveOrder,
  orderSteps,
  visibleSteps,
} from './modules/use-cases/step-order'
import { box, paint, writeLine } from './modules/data/terminal'
import {
  DELIVERIES,
  LIFECYCLES,
  OPERATORS,
  STEP_CHOICES,
  TRUST_CHOICES,
  isNamedLifecycle,
  justArgv,
  resumeArgvFor,
  runArgv,
  shellLine,
} from './modules/use-cases/compose-request'
import type { TDelivery } from './modules/use-cases/compose-request'
import { TRUST_DEFAULT } from './modules/typedefs/trust'

const DEFAULT_DB = '.pi-crust/data/crust.db'

const EXIT = { SUCCESS: 0, CANCELLED: 130 } as const

type TWaiting = Readonly<{
  run_id: string
  lifecycle: string
  status: string
  started_at: string
}>

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
    return db
      .query(
        "SELECT run_id, lifecycle, status, started_at FROM sessions " +
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
      label: `${run.run_id}  ${run.lifecycle}`,
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
 * `@` a lifecycle, `!` an operator, bare a step. A prefix rather than three
 * parallel menus because it is ONE question — "what should it do" — and the
 * answer may legitimately be a named chain, a chain chosen for you, or steps
 * you picked yourself.
 */
const LIFECYCLE_MARK = '@'
const OPERATOR_MARK = '!'

/** The operator chosen, or '' when the chain was named rather than chosen. */
const chosenOperator = (chosen: readonly string[]): string =>
  chosen
    .filter((choice) => choice.startsWith(OPERATOR_MARK))
    .map((choice) => choice.slice(1))[0] ?? ''

/** A chosen lifecycle becomes the steps it runs; a chosen step is itself. */
const expandSteps = (chosen: readonly string[]): readonly string[] =>
  chosen.flatMap((choice) => {
    if (choice.startsWith(OPERATOR_MARK)) return []
    if (!choice.startsWith(LIFECYCLE_MARK)) return [choice]
    const named = LIFECYCLES.find(
      (lifecycle) => lifecycle.name === choice.slice(1),
    )
    return named === undefined ? [] : [...named.steps]
  })

/** A new run: steps, prompt, trust, delivery, approval point. */
const planNewRun = async (): Promise<readonly string[] | undefined> => {
  /*
   * The config decides what the menu offers and what order a selection runs
   * in. Read here rather than threaded in, because `please` is the only
   * caller and a parameter would exist solely to be passed one level.
   */
  const cfg = loadConfig(configPathFromEnv() ?? DEFAULT_CONFIG_PATH)
  const order = effectiveOrder(cfg.steps.order)
  const offered = visibleSteps(STEP_CHOICES, cfg.steps.hidden)

  const chosen = await askMenuChoice(
    'what should it do?',
    [
      ...LIFECYCLES.map((lifecycle) => ({
        value: `${LIFECYCLE_MARK}${lifecycle.name}`,
        label: lifecycle.name,
        detail: lifecycle.summary,
      })),
      ...OPERATORS.map((operator) => ({
        value: `${OPERATOR_MARK}${operator.name}`,
        label: `${operator.name} — let it choose`,
        detail: operator.summary,
      })),
      ...orderSteps(offered, order).map((step) => ({
        value: step,
        label: `  ${step}`,
        detail: '',
      })),
    ],
    {
      multiple: true,
      preselected: [0],
      /*
       * Lifecycles and operators are both exclusive, and exclusive with each
       * other: each answers the whole question. A lifecycle names the chain,
       * an operator chooses it, and a list of steps IS one — so any two of
       * them together are two answers where one was asked for. Picking
       * `scout` while `sdlc` was still held once produced a run that did the
       * entire lifecycle and then scouted.
       */
      exclusive: [...LIFECYCLES, ...OPERATORS].map((_, index) => index),
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

        const operator = chosenOperator(shown)
        if (operator !== '') {
          const says = `${operator} chooses the chain, then runs it`
          return previewing ? `${says}   (not selected)` : says
        }
        const chain = orderSteps(expandSteps(shown), order)
        if (chain.length === 0) return 'nothing yet'
        return previewing
          ? `${chain.join(' → ')}   (not selected)`
          : chain.join(' → ')
      },
    },
  )
  const chosenSteps = chosen.values
  if (chosenSteps === undefined) return undefined
  if (chosenSteps.length === 0) {
    writeLine(paint('nothing chosen.', 'yellow'))
    return undefined
  }

  const operator = chosenOperator(chosenSteps)
  /*
   * Sorted into the configured order, not the order they were ticked.
   *
   * Tick order was the rule before, and it was undiscoverable and
   * inconsistent — `a` for all produced list order from the same screen.
   * Anyone who wants a different sequence says so with `r`, once.
   */
  const defaultOrder = orderSteps(expandSteps(chosenSteps), order)
  const steps =
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

  const delivery = await askOne('how should it hand the work over?', [
    {
      value: 'branch',
      label: 'branch',
      detail: 'a branch you can look at before anything merges',
    },
    { value: 'patch', label: 'patch', detail: 'a diff, applied to nothing' },
    {
      value: 'commit',
      label: 'commit',
      detail: 'committed where you are — only when you already trust the chain',
    },
  ])
  if (delivery === undefined) return undefined

  /*
   * Not asked when an operator is choosing: its steps do not exist yet, so a
   * menu of them would be a menu of nothing. The operator's own chain gate
   * covers the same ground — below trust 50 it shows you the chain before
   * running a step of it.
   */
  const approveAfter =
    operator !== ''
      ? ''
      : await askOne('stop and show you, after which step?', [
          {
            value: '',
            label: 'nowhere extra',
            detail: 'the gates the lifecycle already defines still apply',
          },
          ...steps.map((step) => ({ value: step, label: step, detail: '' })),
        ])
  if (approveAfter === undefined) return undefined

  const stream = await askOne('show its thinking as it goes?', [
    { value: 'yes', label: 'yes', detail: 'narration streams into the trace' },
    { value: 'no', label: 'no', detail: 'quieter; the trace still records it' },
  ])
  if (stream === undefined) return undefined

  return runArgv({
    lifecycle: isNamedLifecycle(steps) ? 'named' : 'compose',
    operator,
    steps,
    prompt,
    trustLevel: Number(trust),
    delivery: (DELIVERIES.find((each) => each === delivery) ??
      'branch') as TDelivery,
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

  const argv =
    which === NEW_RUN ? await planNewRun() : await planResume(which)
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
   * Shown as the `just` recipe, not as the bun line that runs underneath it.
   * The bun path names an install directory and goes stale the moment that
   * moves; `just crust …` is the interface every README and error message
   * already prints, and it is the line worth learning.
   */
  const line = shellLine(justArgv(argv))
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
    { value: 'run', label: 'run it', detail: 'starts now, attached to this terminal' },
    { value: 'print', label: 'just give me the line', detail: 'copy it, change it, run it yourself' },
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
