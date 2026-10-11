/**
 * The eight pure-agent steps, each a factory over `agentStep`.
 *
 * They differ only in owner, output type, gates, and what makes them
 * acceptable, so they live together: splitting eight five-line factories across
 * eight files would hide the one table a reader actually wants.
 *
 * `test` writes the tests and `verify` runs them. Writing a test is judgement,
 * so it is an agent; running one is a command, so it is code. `review` asks
 * whether what was built is what was asked for; `code-review` asks whether it
 * conforms to the repository's ratified conventions, which it learns by loading
 * the skills `routing.skills` hands it — never by having them copied in here.
 * `revise` answers whichever of the two said no.
 */

import {
  buildOutput,
  conceptualizeOutput,
  operatorPlanOutput,
  researchOutput,
  uxDesignOutput,
  designOutput,
  diagnosisOutput,
  genericOutput,
  identifyOutput,
  pocOutput,
  narrowEnvelope,
  planOutput,
  reviewOutput,
  scoutOutput,
} from '../../typedefs/envelope'
import type {
  TStep,
  TStepContext,
  TStepName,
  TStepOptions,
} from '../../typedefs/step'
import {
  artifactsExist,
  diffMatchesClaims,
  disputesSupported,
  filesNonEmpty,
  reproductionSupported,
  stepsValid,
  verdictConsistent,
} from '../gates'
import { selectedPaths } from '../select-range'
import { agentStep } from './agent-step'

const succeeded = (envelope: Readonly<{ status: string }>): boolean =>
  envelope.status === 'success'

/** What the previous step says it changed — what a reviewer should route on. */
const claimedPaths = (ctx: TStepContext): readonly string[] | undefined => {
  const previous = narrowEnvelope(buildOutput, ctx.previous)
  const claimed = previous?.changed_files
  return claimed !== undefined && claimed.length > 0 ? claimed : undefined
}

/**
 * What a reviewing step routes on: the named change when there is one.
 *
 * Without `--base` this is the chain's own claim, exactly as before. With one,
 * the work may be committed and absent from the working tree, so the paths come
 * from the ref or range the developer named instead.
 */
const judgedPaths =
  (base: string) =>
  (ctx: TStepContext): readonly string[] | undefined =>
    base === '' ? claimedPaths(ctx) : selectedPaths(base)

export const promptStep = (options: TStepOptions): TStep =>
  agentStep({
    name: 'prompt',
    owner: options.agent,
    description: `Send the request straight to ${options.agent} and parse its envelope`,
    spec: genericOutput,
    gates: [],
    retries: 0,
    instance: options.instance,
    accepted: succeeded,
  })

export const scoutStep = (options: TStepOptions): TStep =>
  agentStep({
    name: 'scout',
    owner: 'scout',
    description: 'Find and report where things live — change nothing',
    spec: scoutOutput,
    gates: [artifactsExist],
    retries: 0,
    instance: options.instance,
    accepted: succeeded,
  })

export const planStep = (options: TStepOptions): TStep =>
  agentStep({
    name: 'plan',
    owner: 'planner',
    description: 'Turn the request into an implementable plan',
    spec: planOutput,
    gates: [artifactsExist, filesNonEmpty],
    retries: 0,
    instance: options.instance,
    accepted: succeeded,
  })

export const testStep = (options: TStepOptions): TStep =>
  agentStep({
    name: 'test',
    owner: 'tester',
    description:
      'Write the tests that would prove this request was implemented, and nothing else',
    spec: buildOutput,
    gates: [diffMatchesClaims],
    retries: 1,
    instance: options.instance,
    accepted: succeeded,
  })

export const buildStep = (options: TStepOptions): TStep =>
  agentStep({
    name: 'build',
    owner: 'builder',
    description:
      'Implement the plan exactly, or the request itself when no plan precedes it',
    spec: buildOutput,
    gates: [diffMatchesClaims],
    retries: 1,
    instance: options.instance,
    accepted: succeeded,
  })

export const identifyStep = (options: TStepOptions): TStep =>
  agentStep({
    name: 'identify',
    owner: 'analyst',
    description:
      'Turn the problem into an outcome with success criteria that can be recognised',
    spec: identifyOutput,
    gates: [artifactsExist],
    retries: 1,
    instance: options.instance,
    accepted: succeeded,
  })

/**
 * diagnose: find out what is actually happening before anyone decides what to do.
 *
 * Owned by the diagnostician and deliberately read-only. The temptation when a
 * cause becomes obvious is to fix it in the same breath — and a fix applied
 * during diagnosis is a fix nobody planned, nobody tested, and nobody reviewed.
 *
 * `accepted` is `succeeded`, not `reproduced`: failing to reproduce is a
 * finding, not a failure. A chain that treated it as failure would push the
 * agent to manufacture a reproduction, which is the one outcome worse than
 * admitting there is none.
 */
export const diagnoseStep = (options: TStepOptions): TStep =>
  agentStep({
    name: 'diagnose',
    owner: 'diagnostician',
    description:
      'Reproduce the reported behaviour and name its cause, with evidence',
    spec: diagnosisOutput,
    gates: [artifactsExist, reproductionSupported],
    retries: 1,
    instance: options.instance,
    accepted: succeeded,
  })

export const conceptualizeStep = (options: TStepOptions): TStep =>
  agentStep({
    name: 'conceptualize',
    owner: 'solutions-architect',
    description:
      'Decide what the solution must mean and do, before anything decides how',
    spec: conceptualizeOutput,
    gates: [artifactsExist],
    retries: 1,
    instance: options.instance,
    accepted: succeeded,
  })

export const designStep = (options: TStepOptions): TStep =>
  agentStep({
    name: 'design',
    owner: 'technical-architect',
    description:
      'Give the logical architecture a physical shape here, observability included',
    spec: designOutput,
    gates: [artifactsExist],
    retries: 1,
    instance: options.instance,
    accepted: succeeded,
  })

export const pocStep = (options: TStepOptions): TStep =>
  agentStep({
    name: 'poc',
    owner: 'builder',
    description:
      'Test one named hypothesis with the smallest thing that could answer it',
    spec: pocOutput,
    gates: [diffMatchesClaims],
    retries: 1,
    instance: options.instance,
    // A POC that DISPROVES its hypothesis succeeded: it bought the answer
    // early and cheaply. Only a POC that could not answer at all failed.
    accepted: succeeded,
  })

export const reviewStep = (options: TStepOptions): TStep =>
  agentStep({
    name: 'review',
    owner: 'reviewer',
    description:
      'Rule on every requirement in the spec, against the code on disk',
    spec: reviewOutput,
    gates: [artifactsExist, verdictConsistent],
    retries: 0,
    instance: options.instance,
    accepted: (envelope) => envelope.approved,
    changedPathsOf: judgedPaths(options.base),
    changeBase: options.base,
  })

export const codeReviewStep = (options: TStepOptions): TStep =>
  agentStep({
    name: 'code-review',
    owner: 'code-reviewer',
    description:
      "Judge the change against this repository's ratified conventions, through its own review skill",
    spec: reviewOutput,
    gates: [artifactsExist, verdictConsistent],
    retries: 0,
    instance: options.instance,
    accepted: (envelope) => envelope.approved,
    changedPathsOf: judgedPaths(options.base),
    changeBase: options.base,
  })

/**
 * revise: answer a review's blocking findings, with a fix or with evidence.
 *
 * The builder's own output type, not a second one: one `user.md` serves both
 * activityRuns, and a separate schema would split the synced triad across one prompt.
 * `disputesSupported` is what stops "I disagree" being an answer.
 */
export const reviseStep = (options: TStepOptions): TStep =>
  agentStep({
    name: 'revise',
    owner: 'builder',
    description:
      'Answer every blocking finding the review named — fix it, or dispute it with evidence',
    spec: buildOutput,
    gates: [diffMatchesClaims, disputesSupported],
    retries: 1,
    instance: options.instance,
    accepted: succeeded,
  })

/*
 * The research disciplines.
 *
 * Five steps, one factory shape, one output schema: they investigate
 * different subjects and read different sources, but they answer the same
 * contract — what is true, how it is known, how sure, and what is unsettled.
 * The difference between them lives in the prompt and the roster, which is
 * where a difference of DISCIPLINE belongs; expressing it as five schemas
 * would put it in the type system, where it would drift.
 *
 * Every one is read-only and accepted on `succeeded`. Research that reaches
 * no conclusion has still done its job if it says so — a discipline whose
 * step fails when the answer is "the evidence does not settle this" is a
 * discipline being paid to manufacture certainty.
 */
const researchStep =
  (name: TStepName, owner: string, description: string) =>
  (options: TStepOptions): TStep =>
    agentStep({
      name,
      owner,
      description,
      spec: researchOutput,
      gates: [artifactsExist],
      retries: 1,
      instance: options.instance,
      accepted: succeeded,
    })

export const technicalResearchStep = researchStep(
  'technical-research',
  'technical-researcher',
  'Establish what is technically true, feasible, and supported by evidence',
)

export const uxResearchStep = researchStep(
  'ux-research',
  'ux-researcher',
  'Establish what users need, experience, understand, and struggle with',
)

export const domainResearchStep = researchStep(
  'domain-research',
  'domain-researcher',
  'Establish an accurate model of the domain and the rules that govern it',
)

export const securityResearchStep = researchStep(
  'security-research',
  'security-researcher',
  'Establish how this could fail, be misused, or be attacked',
)

export const dataResearchStep = researchStep(
  'data-research',
  'data-researcher',
  'Establish what the empirical evidence says, and what it cannot say',
)

/**
 * ux-design: validated needs become something an engineer can build.
 *
 * Not a research step, and separated from them deliberately: research
 * establishes what is true, and this DECIDES. Its output must be precise
 * enough that an implementer invents no UX of their own — which is why its
 * schema demands states and accessibility per surface, and demands that
 * anything deliberately left open is said out loud rather than omitted.
 */
export const uxDesignStep = (options: TStepOptions): TStep =>
  agentStep({
    name: 'ux-design',
    owner: 'ux-designer',
    description:
      'Turn validated needs into an interface specification somebody can implement',
    spec: uxDesignOutput,
    gates: [artifactsExist, filesNonEmpty],
    retries: 1,
    instance: options.instance,
    accepted: succeeded,
  })

/**
 * triage: choose the chain, and hand it back rather than run it.
 *
 * Identical reasoning to the operator, identical envelope, and deliberately
 * NOT the operator with a flag. A run's trace should say what was going to
 * happen without a reader having to recover the flags it started with, and
 * `operator` means "the rest of this run is about to be chosen for you"
 * while `triage` means "nothing follows this".
 *
 * `stepsValid` still applies. A recommendation naming a step that does not
 * exist is a command the developer cannot run, which is the same defect as
 * a chain that cannot start.
 */
export const triageStep = (options: TStepOptions): TStep =>
  agentStep({
    name: 'triage',
    owner: 'triage',
    description:
      'Choose the smallest chain that can produce the outcome, and hand it back as a command',
    spec: operatorPlanOutput,
    gates: [stepsValid],
    retries: 1,
    instance: options.instance,
    accepted: succeeded,
  })

/**
 * operator: choose the chain, and run none of it.
 *
 * The only step whose envelope is EXECUTED rather than read — `steps` becomes
 * the rest of the run. Hence `stepsValid`, which is not a formality: an
 * invented step name is not a weak recommendation, it is a chain that cannot
 * start, and the gate hands the operator its own mistake to fix inside the
 * same session.
 *
 * It owns no work. Every step it plans belongs to somebody else, and the
 * operator's job ends when the list does.
 */
export const operatorStep = (options: TStepOptions): TStep =>
  agentStep({
    name: 'operator',
    owner: 'operator',
    description:
      'Choose the smallest chain of steps that can produce the outcome, and run none of it',
    spec: operatorPlanOutput,
    gates: [stepsValid],
    retries: 1,
    instance: options.instance,
    accepted: succeeded,
  })
