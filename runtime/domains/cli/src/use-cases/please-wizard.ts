import { TRUST_DEFAULT } from '../../../../lib/contracts'
import { paint, writeLine } from '../../../../lib/terminal'
import { loadConfig } from '../../../config'
import { lifecyclesBeside, loadLifecycles } from '../../../planning'
import type { TWaitingRun } from '../../../trace'
import {
  type askMenuChoice,
  type askOne,
  type askOrder,
  type askText,
  chosenLifecycle,
  chosenPlanner,
  displayLabel,
  exclusiveCount,
  expandChoices,
  menuOptions,
  resumeArgvFor,
  runArgv,
  TRUST_CHOICES,
} from '../..'

export const NEW_RUN = '\u0000new'

/** Which run, if any. Undefined means they backed out. */
export const askWhichRun =
  (ports: TAskPorts) =>
  async (waiting: readonly TWaitingRun[]): Promise<string | undefined> => {
    if (waiting.length === 0) return NEW_RUN

    const chosen = await ports.askOne(
      'a run is waiting for you. pick one up?',
      [
        ...waiting.map((run) => ({
          value: run.run_id,
          label: `${run.run_id}  ${displayLabel(run.name ?? '', run.lifecycle)}`,
          detail: `waiting since ${run.started_at}`,
        })),
        { value: NEW_RUN, label: 'start something new', detail: '' },
      ],
    )
    return chosen
  }

/** Answering a waiting run. Approve, reject and answer all mean "carry on". */
export const planResume =
  (ports: TAskPorts) =>
  async (runId: string): Promise<readonly string[] | undefined> => {
    const verb = await ports.askOne(
      `${runId} is waiting. what are you telling it?`,
      [
        {
          value: 'approve',
          label: 'approve',
          detail: 'carry on as proposed, with nothing further from me',
        },
        {
          value: 'answer',
          label: 'answer',
          detail:
            'I have something to say, and the next stage treats it as fact',
        },
        {
          value: 'reject',
          label: 'reject',
          detail:
            'not this — and here is why, which the next stage must honour',
        },
      ],
    )
    if (verb === undefined) return undefined
    if (verb === 'approve') {
      return resumeArgvFor({ runId, verb: 'approve', note: '' })
    }

    const note = await ports.askText(
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
export const planNewRun =
  (ports: TAskPorts) =>
  async (configPath: string): Promise<readonly string[] | undefined> => {
    /*
     * The config decides what the menu offers and what order a selection runs
     * in. Read here rather than threaded in, because `please` is the only
     * caller and a parameter would exist solely to be passed one level.
     */
    const cfg = loadConfig(configPath)
    const lifecycles = loadLifecycles(lifecyclesBeside(configPath), cfg)
    const options = menuOptions(cfg.activities, lifecycles)

    const chosen = await ports.askMenuChoice('what should it do?', options, {
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
        ? ((await ports.askOrder('what order?', defaultOrder)) ?? defaultOrder)
        : defaultOrder

    const prompt = await ports.askText(
      'what is the ask? (a sentence, or a file path)',
    )
    if (prompt === undefined || prompt === '') {
      writeLine(paint('a run needs something to do.', 'yellow'))
      return undefined
    }

    const trust = await ports.askOne(
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
    const commit = await ports.askOne('may it commit as it goes?', [
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
        ? await ports.askOne('stop and show you, after which activity?', [
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

    const stream = await ports.askOne('show its thinking as it goes?', [
      {
        value: 'yes',
        label: 'yes',
        detail: 'narration streams into the trace',
      },
      {
        value: 'no',
        label: 'no',
        detail: 'quieter; the trace still records it',
      },
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

export type TAskPorts = Readonly<{
  askOne: typeof askOne
  askText: typeof askText
  askOrder: typeof askOrder
  askMenuChoice: typeof askMenuChoice
}>
