/**
 * How much latitude the agents have, as one number.
 *
 * Zero to a hundred in tens. Most of the range is headroom on purpose: a dial
 * with ten distinct behaviours would look precise and be unlearnable, and the
 * first person to choose 40 over 30 would have no idea what they bought. Three
 * thresholds change anything.
 *
 *   0          every question stops the run, consequential or not
 *   10-40      a consequential question stops the run
 *   50-90      a consequential question stops the run only when the answer is
 *              IRREVERSIBLE; otherwise the stage answers provisionally, says
 *              so, and the run reports it at the end (the default)
 *   100        nothing stops the run unless a person asked it to
 *
 * `--approve-after` is unaffected at every level, including 100. The dial is
 * about what AGENTS may decide for themselves; an explicit gate is about what
 * YOU want to see, and collapsing the two would let a trust setting silently
 * disable a flag somebody typed.
 *
 * Reversibility, not importance, is the test. A schema, a migration, a
 * a deployment and a push are beyond it. A document about either is not.
 * The asking stage proposes which it is, and the receiving stage can still
 * refuse at intake — only the party that must proceed can honestly say whether
 * it can.
 */

export const TRUST_STEP = 10
export const TRUST_MAX = 100

/**
 * The level a run uses when nobody said otherwise.
 *
 * It was 20, which stopped the run on every consequential question whether
 * or not the answer could be undone. That is the right setting for the first
 * week and the wrong one thereafter: most consequential questions are
 * reversible, so the run stopped constantly for decisions a person would
 * have waved through — and a gate that fires on everything is a gate people
 * learn to approve without reading, which is worse than no gate.
 *
 * At 50 a question the stage can defend an answer to is decided, said out
 * loud, and listed again at the end of the run. What still stops everything
 * is a question it could NOT answer, or one whose action reaches beyond what
 * discarding this run would undo. The protection moves from "ask about
 * anything that matters" to "ask when you do not know, or when it is not
 * yours to undo".
 */
export const TRUST_DEFAULT = 50

/** The level below which nothing is left to an agent's judgement. */
export const TRUST_NOTHING = 0

/** At or above this, a reversible question is answered rather than asked. */
export const TRUST_PROVISIONAL = 50

/** At this, no question stops the run on its own. */
export const TRUST_TOTAL = 100

/**
 * The names the dial actually has, and the level each one means.
 *
 * There are four distinct behaviours and three thresholds, so there are four
 * names. The numbers remain the storage format — the trace, the flag and the
 * config have all recorded them from the start — but a number invites a
 * precision this dial does not have: 80 and 60 and 50 are the same run, and
 * a person who types 80 believes they bought something.
 */
export const TRUST_NAMES: Readonly<Record<string, number>> = {
  none: TRUST_NOTHING,
  low: 20,
  medium: TRUST_PROVISIONAL,
  high: TRUST_TOTAL,
}

/** The band a level falls in, named — what it will actually do. */
export const trustBand = (level: number): string => {
  if (level <= TRUST_NOTHING) return 'none'
  if (level >= TRUST_TOTAL) return 'high'
  return level >= TRUST_PROVISIONAL ? 'medium' : 'low'
}

/** What a band does, in one clause, for a banner. */
export const trustMeans = (level: number): string => {
  if (level <= TRUST_NOTHING) return 'every question stops this run'
  if (level >= TRUST_TOTAL) {
    return 'no question stops this run unless you asked it to'
  }
  if (level >= TRUST_PROVISIONAL) {
    return 'it decides what it can defend and reports it; only an open question or an action beyond this run stops it'
  }
  return 'every consequential question stops this run, reversible or not'
}

/**
 * What to tell a person about the level in force.
 *
 * When a number lands between thresholds it says so. `--trust-level 80`
 * behaves exactly as 50, which is defensible — a dial with ten behaviours
 * would be unlearnable — but accepting a precision it does not honour and
 * then printing the number back is how somebody believes they tuned
 * something. Now it says which band it landed in and what that means.
 */
export const describeTrust = (level: number): string => {
  const band = trustBand(level)
  const named = TRUST_NAMES[band] === level
  const head = named
    ? `trust ${band} (${level})`
    : `trust ${level} behaves as ${band} (${TRUST_NAMES[band] ?? level})`
  return `${head}: ${trustMeans(level)}`
}

/**
 * A level from text: a name, or a number rounded to the nearest ten.
 *
 * Anything unparseable reads as "not set" rather than as zero: an exported
 * variable holding a typo must not silently become the most conservative
 * setting and halve the speed of every run with no explanation.
 */
export const parseTrustLevel = (
  value: string | undefined,
  fallback: number = TRUST_DEFAULT,
): number => {
  const text = (value ?? '').trim()
  /*
   * Empty is NOT SET, and must be said before the number is read.
   *
   * `Number('')` is 0, not NaN — so an unset variable walked straight past
   * the finite check below and became the most conservative setting. Every
   * run launched without `--trust-level` and without the variable exported
   * has been at 0 rather than at the default, which is precisely the silent
   * halving this function's comment claims to prevent.
   */
  if (text === '') return fallback
  // A name first. Numbers still parse, because every trace, flag and config
  // written before today holds one.
  const named = TRUST_NAMES[text.toLowerCase()]
  if (named !== undefined) return named
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) return fallback
  const rounded = Math.round(parsed / TRUST_STEP) * TRUST_STEP
  return Math.min(TRUST_MAX, Math.max(0, rounded))
}

/**
 * The level in force: the flag, else the environment, else the default.
 *
 * Same precedence as every other setting here — a flag is typed for one
 * command, while an exported variable outlives the terminal it was set in.
 */
export const trustLevel = (
  flag: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): number =>
  flag === undefined || flag.trim() === ''
    ? parseTrustLevel(env.CRUST_TRUST_LEVEL)
    : parseTrustLevel(flag)

export type TQuestionStance = 'gate' | 'answer-provisionally'

/**
 * What a stage should do with a question it could not answer.
 *
 * The axis changed, and the reason is worth keeping. It used to be
 * IRREVERSIBILITY: a question whose answer named a schema, a migration or a
 * public interface stopped a run at medium. That sounds right and is not —
 * an agent correctly calls a schema irreversible, but the run was writing a
 * PLAN about a schema, and nothing it did could not be undone by deleting a
 * markdown file. Measured over every question the factory has ever written,
 * 12 of 40 were marked consequential AND irreversible, and they were
 * questions like "which naming survives" and "is that year 2026 or 2025" —
 * things a colleague would decide, state, and be corrected on later.
 *
 * An autonomous run has exactly two honest reasons to stop:
 *
 * - it CANNOT answer — no defensible provisional answer exists, so carrying
 *   on is invention rather than judgement
 * - answering means acting BEYOND THIS RUN — a push, a deploy, a migration
 *   against real data, money, anything a human cannot undo by discarding the
 *   run's output
 *
 * Neither is "is this consequential". Consequential describes nearly every
 * interesting question, which is why agents marked 29 of 40 that way and
 * were not wrong to. It is kept, because it is the right lens for REPORTING
 * a decision afterwards; it is simply not the lens for blocking.
 */
export const stanceFor = (params: {
  readonly level: number
  /** does the stage have a defensible answer it would act on unasked */
  readonly answerable: boolean
  /** would acting reach outside what discarding this run would undo */
  readonly beyondThisRun: boolean
  /** kept for the LOW setting, where the old behaviour is the point */
  readonly consequential: boolean
}): TQuestionStance => {
  const { level, answerable, beyondThisRun, consequential } = params
  if (level <= TRUST_NOTHING) return 'gate'
  /*
   * At HIGH nothing stops on a question, including one the stage could not
   * answer. That is not recklessness: an unanswerable question at this level
   * is a DEFECT IN THE REPORT, surfaced at the end, and the setting exists
   * precisely for "do not come back until it is done". A gate here would
   * make the top of the dial indistinguishable from the middle.
   */
  if (level >= TRUST_TOTAL) return 'answer-provisionally'
  if (level >= TRUST_PROVISIONAL) {
    return !answerable || beyondThisRun ? 'gate' : 'answer-provisionally'
  }
  return consequential ? 'gate' : 'answer-provisionally'
}

/**
 * What the agents are TOLD, rendered into every prompt as `{{trust_stance}}`.
 *
 * This is the half that was missing, and it is why raising the dial never
 * felt like raising anything: the level was a filter applied to the agent's
 * classification AFTER the fact, and no prompt anywhere mentioned it. An
 * agent could not try harder to settle something, because it did not know
 * whether escalating would stop the run or merely be logged.
 *
 * Written in the second person and in the imperative, because it is an
 * instruction about this run rather than a description of a feature.
 */
export const trustStance = (level: number): string => {
  if (level <= TRUST_NOTHING) {
    return [
      '## How much to decide for yourself',
      '',
      'Nothing. Every question you cannot answer from evidence stops this run and comes to a person, however small. Still give `provisional_answer` — it is what they will approve or correct.',
    ].join('\n')
  }
  if (level >= TRUST_TOTAL) {
    return [
      '## How much to decide for yourself',
      '',
      'Everything. This run must not stop. Decide what you cannot establish, act on your best judgement, and say plainly in `unresolved` what you decided and on what basis — a person reads it afterwards and can still overrule you.',
      '',
      'An empty `provisional_answer` is a failure of your work here, not a request for help. If you genuinely cannot form one, say what evidence would let you and proceed with the least destructive option available.',
      '',
      'Nothing escapes this run without saying so first: if the work would push, deploy, spend money, or change data outside what discarding this run would undo, write it down as the next action rather than doing it.',
    ].join('\n')
  }
  if (level >= TRUST_PROVISIONAL) {
    return [
      '## How much to decide for yourself',
      '',
      'Nearly everything. Make the call and report it, as a colleague would: decide, say what you decided and why, and let a person challenge it afterwards. Do not stop to ask something you could defend an answer to.',
      '',
      'Two things do come back to a person, and only two:',
      '',
      '- a question you genuinely cannot form a defensible answer to — leave `provisional_answer` empty and it will reach them',
      '- an answer whose action reaches BEYOND this run: a push, a deploy, a migration against real data, spend, or anything else discarding this run would not undo — set `beyond_this_run: true`',
      '',
      '"Important" is not one of them. A schema this run only writes a document about is not beyond this run; the migration that would later apply it is.',
    ].join('\n')
  }
  return [
    '## How much to decide for yourself',
    '',
    'The routine ones only. Settle what is small and local; anything consequential — anything a later stage would have to invent an answer for — goes to a person with `consequential: true`. Give a `provisional_answer` anyway, so they can approve rather than compose.',
  ].join('\n')
}
