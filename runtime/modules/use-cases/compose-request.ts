/**
 * Turning a set of answers into the command pi-crust would have been typed.
 *
 * `please` exists because the flags are learnable but not memorable: a
 * lifecycle, a trust level, a delivery mode and an approval point is four
 * decisions, and the cost of getting one wrong is a run you have to kill. A
 * menu makes each decision visible with its options beside it.
 *
 * Everything here is pure, and the TTY lives elsewhere. The interesting part
 * of a wizard is not the key handling — it is whether the command at the end
 * is the one the answers describe, and that is only testable if building it
 * never touches a terminal.
 */

import { TRUST_DEFAULT } from '../typedefs/trust'

/**
 * An agent that chooses the chain instead of being given one.
 *
 * A third kind of thing, beside lifecycles and steps. `operator` is the only
 * one today, and it is a list rather than a special case because the next one
 * is a different POLICY for choosing — cheapest-first, most-thorough,
 * bug-shaped — and those are siblings of this, not variants of a step.
 *
 * Like a lifecycle it answers the whole question: you cannot have an operator
 * AND a lifecycle, because both decide the chain, and you cannot have an
 * operator AND steps, because naming the steps is the thing an operator is
 * for.
 */
export type TOperator = Readonly<{ name: string; summary: string }>

export const OPERATORS: readonly TOperator[] = [
  {
    name: 'operator',
    summary: 'it picks the smallest chain that can produce the outcome',
  },
]

/** What a trust level means, phrased as the thing it changes. */
export type TTrustChoice = Readonly<{
  level: number
  label: string
  detail: string
}>

/**
 * The three the wizard offers, named as the dial names them.
 *
 * Three, not four: `none` — stop on every question including the trivial
 * ones — is a debugging setting rather than a way to work, and offering it
 * beside the others invites somebody to pick it once and conclude the whole
 * thing is unusable. It is still reachable with `--trust-level none`.
 *
 * Levels are spelled out rather than derived from TRUST_DEFAULT, because
 * these are points on a dial a person is reading: binding one to whatever
 * the default happens to be would silently lose an option the day the
 * default moves, which is exactly what happened when it moved to 50.
 */
export const TRUST_CHOICES: readonly TTrustChoice[] = [
  {
    level: 20,
    label: 'low',
    detail:
      'routine decisions — it settles the small ones and asks about anything consequential',
  },
  {
    level: 50,
    label: 'medium',
    detail:
      'it decides what it can defend and tells you afterwards; it stops only when it has no answer, or when acting would reach beyond this run',
  },
  {
    level: 100,
    label: 'high',
    detail:
      'everything — it answers its own questions and shows you what it assumed',
  },
]

/**
 * Everything a new run needs, as a menu collects it.
 *
 * `approveAfter` empty means "do not stop anywhere extra" — the gates the
 * lifecycle itself defines still apply. It is not optional in the type,
 * because a wizard always has an answer for every question it asked, even if
 * the answer is "none".
 */
export type TRunRequest = Readonly<{
  /** the Lifecycle chosen by name, or '' when Activities were picked */
  lifecycle: string
  /**
   * The operator chosen, or '' when the chain was named rather than chosen.
   *
   * Mutually exclusive with `steps` by construction: when this is set the
   * steps are not known yet, because working them out is the run's first
   * activityRun.
   */
  operator: string
  steps: readonly string[]
  prompt: string
  trustLevel: number
  /**
   * Whether the Activities that declare `commit: true` may commit.
   *
   * There is no way to say yes to one that did not declare it: the flag
   * only subtracts, so a run can never do something nobody reading the
   * registry could have predicted.
   */
  commit: boolean
  approveAfter: string
  stream: boolean
}>

/** What to do with a run that is already waiting on a person. */
export type TResumeRequest = Readonly<{
  runId: string
  verb: 'approve' | 'reject' | 'answer'
  note: string
}>

/**
 * The argv for a new run.
 *
 * Three shapes, because there are three ways to say what should happen: a
 * Planner chooses it, a Lifecycle names it, or the Activities are listed.
 * A chosen Lifecycle is passed BY NAME rather than flattened into `--steps`,
 * so the trace records `sdlc` rather than an anonymous chain that happens to
 * look like it, and a run stays searchable by the name the person had in
 * mind.
 *
 * Defaults are OMITTED rather than written out. A command line that states
 * every value cannot be read for intent — the whole point of seeing the
 * command before it runs is noticing the flag you did not mean.
 */
export const runArgv = (request: TRunRequest): readonly string[] => {
  const chosen = request.operator !== ''
  /*
   * A planner run carries NO `--steps` and no `--lifecycle`, and not merely
   * because none were chosen: the two together are refused by the stage
   * itself, since one asks it to choose the chain and the other names it.
   */
  const script = chosen
    ? `.pi-crust/stages/${request.operator}.ts`
    : '.pi-crust/lifecycles/compose.ts'

  return [
    'bun',
    script,
    request.prompt,
    ...(chosen
      ? []
      : request.lifecycle !== ''
        ? ['--lifecycle', request.lifecycle]
        : ['--steps', request.steps.join(',')]),
    ...(request.trustLevel === TRUST_DEFAULT
      ? []
      : ['--trust-level', String(request.trustLevel)]),
    ...(request.commit ? [] : ['--commit', 'false']),
    ...(request.approveAfter === ''
      ? []
      : ['--approve-after', request.approveAfter]),
    ...(request.stream ? ['--stream'] : []),
  ]
}

/** The argv for answering a run that is waiting. */
export const resumeArgvFor = (request: TResumeRequest): readonly string[] => [
  'bun',
  '.pi-crust/decide.ts',
  request.verb,
  request.runId,
  ...(request.note === '' ? [] : ['--note', request.note]),
]

/**
 * The command as a person would type it, for showing before it runs.
 *
 * Quoting is deliberately minimal: a quote around every argument is noise
 * that hides the one argument that genuinely needed quoting.
 */
export const shellLine = (argv: readonly string[]): string =>
  argv
    .map((part) => (/^[\w.,/=:-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(' ')

/**
 * The same command as a `just` recipe.
 *
 * This is the line to HAND somebody. `bun .pi-crust/lifecycles/sdlc.ts "…"`
 * is what runs, but it names an install path, so it breaks the moment the
 * directory moves and it teaches the wrong thing to whoever reads it over a
 * shoulder. `just crust sdlc "…"` is the documented interface, and it is
 * the one every README, cookbook and error message already prints.
 *
 * Anything with no recipe behind it falls back to the bun line rather than
 * inventing a recipe name — a command that does not exist is worse than a
 * long one that does.
 */
export const justArgv = (argv: readonly string[]): readonly string[] => {
  const [runner, script, ...rest] = argv
  if (runner !== 'bun' || script === undefined) return argv

  const recipe = recipeFor(script, rest)
  return recipe === undefined ? argv : ['just', 'crust', ...recipe]
}

const LIFECYCLE_PATH = /^\.pi-crust\/lifecycles\/([\w-]+)\.ts$/
const STAGE_PATH = /^\.pi-crust\/stages\/([\w-]+)\.ts$/

const recipeFor = (
  script: string,
  rest: readonly string[],
): readonly string[] | undefined => {
  const lifecycle = LIFECYCLE_PATH.exec(script)?.[1]
  if (lifecycle !== undefined) return [lifecycle, ...rest]

  const stage = STAGE_PATH.exec(script)?.[1]
  if (stage !== undefined) return [stage, ...rest]

  /*
   * `decide.ts approve <id>` is three recipes, one per verb, each taking the
   * run id first — so the verb becomes the recipe name and drops out of the
   * arguments.
   */
  if (script === '.pi-crust/decide.ts') {
    const [verb, ...args] = rest
    return verb === undefined ? undefined : [verb, ...args]
  }
  return undefined
}
