/**
 * Envelopes — the agent output types.
 *
 * Every agent call declares a concrete output type that its final JSON response
 * is parsed against. No untyped handoffs.
 *
 * The output contract is a SYNCED TRIAD: the schema here, the `## Report` JSON
 * example in that agent's `user.md`, and `outputType:` at every call site.
 * Change one, change all three in the same edit.
 *
 * Field names are snake_case because they are the wire contract with the model,
 * not an internal shape — the prompts ask for exactly these keys.
 */

import { z } from 'zod'

export const envelopeBaseSchema = z.object({
  status: z.enum(['success', 'fail']),
  /** one sentence: what happened */
  summary: z.string().default(''),
  /** paths written, usually inside context_handoff/ */
  artifacts: z.array(z.string()).default([]),
  /** what the next agent must know */
  notes_for_next_agent: z.string().default(''),
})

/** The base every agent's final JSON response shares. */
export type TEnvelopeBase = Readonly<z.infer<typeof envelopeBaseSchema>>

/**
 * One agent call's output contract, carried as a value.
 *
 * `name` goes in the `envelopes.output_type` column and into the correction
 * prompt; `fieldNames` is derived from the schema's shape so the "respond with
 * these fields" correction can never drift from the schema it is correcting.
 */
export type TEnvelopeSpec<TEnvelope extends TEnvelopeBase> = Readonly<{
  name: string
  schema: z.ZodType<TEnvelope>
  fieldNames: readonly string[]
}>

export const envelopeSpec = <TShape extends z.ZodRawShape>(
  name: string,
  schema: Readonly<z.ZodObject<TShape>>,
): TEnvelopeSpec<Readonly<z.infer<z.ZodObject<TShape>>> & TEnvelopeBase> => ({
  name,
  schema: schema as unknown as z.ZodType<
    Readonly<z.infer<z.ZodObject<TShape>>> & TEnvelopeBase
  >,
  fieldNames: Object.keys(schema.shape),
})


// ── The context envelope ─────────────────────────────────────────────────────

/**
 * What a stage hands the next one, beyond its own payload.
 *
 * The lifecycle this factory follows (`adr/context/sdlc.md`) asks every stage
 * to distinguish what it ESTABLISHED from what it DECIDED, ASSUMED, or could
 * not answer. Prose cannot carry that distinction — "we'll use Postgres" reads
 * the same whether it was measured, chosen, or guessed — and a later stage
 * that cannot tell them apart has no way to know which of its foundations is
 * soft.
 *
 * Every field is REQUIRED. A default would let an omission read as an
 * assertion: "no assumptions" is the single most consequential claim a stage
 * makes, and it has to be made on purpose. An empty array is a fine answer and
 * a deliberate one.
 */

/** Something established, and what established it. */
export const factSchema = z.object({
  fact: z.string(),
  /** a path:line, a command and its exit status, a document, an observation */
  evidence: z.string(),
})
export type TFact = Readonly<z.infer<typeof factSchema>>

/** Something chosen, and why — so the next stage need not re-decide it. */
export const decisionSchema = z.object({
  decision: z.string(),
  rationale: z.string(),
})
export type TDecision = Readonly<z.infer<typeof decisionSchema>>

/**
 * Something believed but not established, and what would disprove it.
 *
 * `invalidated_by` is what makes an assumption actionable rather than
 * decorative: it is the regression trigger, and a stage that cannot say what
 * would disprove its assumption has not finished thinking about it.
 */
export const assumptionSchema = z.object({
  assumption: z.string(),
  invalidated_by: z.string(),
})
export type TAssumption = Readonly<z.infer<typeof assumptionSchema>>

/**
 * A question this stage could not answer.
 *
 * Three fields, and each one answers a different reader.
 *
 * `consequential` is for the REPORT: would a later stage have had to invent
 * this. It is what makes a decision worth a person's attention afterwards.
 * It used to be the escalation switch too, and that was the mistake — nearly
 * every interesting question is consequential, so a dial reading it stopped
 * on nearly everything.
 *
 * `provisional_answer` is the escalation switch now, by its absence. '' means
 * "I have no defensible guess", and an autonomous run that proceeds on no
 * guess is inventing rather than deciding. Anything else means the stage is
 * prepared to act and be corrected, which is what a colleague does.
 *
 * `beyond_this_run` is the other reason to stop, and it replaced
 * `irreversible`. The old field asked whether the ANSWER names something
 * costly to undo — a schema, a migration, a public interface — which an
 * agent answers "yes" to constantly and correctly, while the run in front of
 * it was only writing a document. The question that matters is narrower and
 * is about THIS RUN: would acting reach outside what discarding this run's
 * output would undo. A push, a deploy, a migration against real data, spend,
 * an external side effect. Designing a schema is not beyond this run.
 * Applying it is.
 */
export const questionSchema = z.preprocess(
  /*
   * A question written before the rename still parses.
   *
   * This is not politeness toward old data: a resumed run READS ITS OWN
   * ENVELOPES BACK, so a renamed field does not degrade a stale trace, it
   * kills the next resume of a live one. Observed exactly that way — a run
   * waiting at a gate was resumed, died in startup on
   * `unresolved.0.beyond_this_run`, and left its session row saying
   * "running" with nothing running.
   *
   * `irreversible` is mapped rather than defaulted. It asked a broader
   * question than this one does, so a `true` becomes a `true` here and is
   * at worst one unnecessary stop; defaulting the field to false would
   * silently un-gate a question somebody had already been asked.
   */
  (value) => {
    if (value === null || typeof value !== 'object') return value
    const question = value as Record<string, unknown>
    if ('beyond_this_run' in question || !('irreversible' in question)) {
      return question
    }
    const { irreversible, ...rest } = question
    return { ...rest, beyond_this_run: irreversible }
  },
  z.object({
    question: z.string(),
    /** would a later stage have had to invent this — for the report, not the gate */
    consequential: z.boolean(),
    /** would acting reach outside what discarding this run would undo */
    beyond_this_run: z.boolean(),
    /** what this stage would do unasked — '' when there is no defensible guess */
    provisional_answer: z.string(),
  }),
)
export type TQuestion = Readonly<z.infer<typeof questionSchema>>

/** A known way this could fail, and what would blunt it. */
export const riskSchema = z.object({
  risk: z.string(),
  mitigation: z.string(),
})
export type TRisk = Readonly<z.infer<typeof riskSchema>>

/**
 * The stage's claim that it did its job, and the evidence for it.
 *
 * Not "did the activityRun run" — the harness knows that. This is the stage ruling
 * on its own objective, which the next stage's intake is entitled to reject.
 */
export const objectiveSchema = z.object({
  met: z.boolean(),
  evidence: z.string(),
})
export type TObjective = Readonly<z.infer<typeof objectiveSchema>>

/**
 * A stage asking to go BACK, because evidence invalidated earlier work.
 *
 * `activity: ''` means no regression, and is the ordinary answer. Anything else
 * names the earliest stage whose output is now wrong — not the one that is
 * merely inconvenient, and not the stage before this one by reflex.
 *
 * The record is blunt about why this exists: do not compensate for an invalid
 * upstream decision with downstream complexity. A builder that discovers the
 * design cannot work has found something, and the cheap move is to say so
 * rather than to build a workaround nobody will understand in a month.
 */
export const regressionSchema = z.object({
  /** '' for none, else the stage to return to */
  activity: z.string(),
  /** the evidence that invalidated it — not an opinion about it */
  because: z.string(),
})
export type TRegression = Readonly<z.infer<typeof regressionSchema>>

export const contextEnvelopeSchema = envelopeBaseSchema.extend({
  facts: z.array(factSchema),
  decisions: z.array(decisionSchema),
  assumptions: z.array(assumptionSchema),
  unresolved: z.array(questionSchema),
  risks: z.array(riskSchema),
  objective_met: objectiveSchema,
  regress_to: regressionSchema,
})

/** What a stage asked to go back to, or undefined when it did not ask. */
export const regressionOf = (
  envelope: TEnvelopeBase | undefined,
): TRegression | undefined => {
  const parsed =
    envelope === undefined
      ? undefined
      : contextEnvelopeSchema.safeParse(envelope)
  if (parsed === undefined || !parsed.success) {
    return undefined
  }
  return parsed.data.regress_to.activity === ''
    ? undefined
    : parsed.data.regress_to
}

/** Every agent stage's envelope. Code-built envelopes extend the base instead. */
export type TContextEnvelope = Readonly<z.infer<typeof contextEnvelopeSchema>>

// ── Concrete output types ────────────────────────────────────────────────────

/**
 * Narrow an envelope travelling as `TEnvelopeBase` back to its own shape.
 *
 * `TStepContext.previous` is the base type, because a context is folded through
 * steps that each produce something different. Every consumer therefore has to
 * say what it expects, and saying it with `as` is a lie the compiler cannot
 * check: a `review` step handed an `identify` envelope would read `.approved`
 * as `undefined`, conclude the review did not approve, and spend a build-sized
 * call revising against a verdict that was never cast.
 *
 * The schema already exists for every envelope. Use it: `undefined` here means
 * "this is not that kind of envelope", which a caller can act on honestly.
 */
export const narrowEnvelope = <TEnvelope extends TEnvelopeBase>(
  spec: TEnvelopeSpec<TEnvelope>,
  envelope: TEnvelopeBase | undefined,
): TEnvelope | undefined => {
  if (envelope === undefined) {
    return undefined
  }
  const parsed = spec.schema.safeParse(envelope)
  return parsed.success ? (parsed.data as TEnvelope) : undefined
}

/**
 * `prompt` only: one agent, one question, no stage.
 *
 * Deliberately NOT a context envelope. The lifecycle fields exist so a stage
 * can hand its successor something it can rely on, and a one-shot prompt has
 * no successor. Demanding them here would be ceremony, and ceremony is how a
 * required field becomes something an agent fills in to get past it.
 */
export const genericOutputSchema = envelopeBaseSchema
export type TGenericOutput = Readonly<z.infer<typeof genericOutputSchema>>
export const genericOutput = envelopeSpec('GenericOutput', genericOutputSchema)

export const planOutputSchema = contextEnvelopeSchema.extend({
  // Subject for committing the PLAN — the spec file the planner wrote, not the
  // implementation it describes. Each agent's commit_message covers its own
  // work product, so a chain that commits per step never reuses one agent's
  // words for another agent's diff.
  commit_message: z.string().default(''),
})
export type TPlanOutput = Readonly<z.infer<typeof planOutputSchema>>
export const planOutput = envelopeSpec('PlanOutput', planOutputSchema)

/**
 * One reviewer finding the builder is answering with evidence instead of a fix.
 *
 * `finding` quotes the blocking item it answers, so the harness can match the
 * two without guessing. `evidence` is the part that makes it a dispute rather
 * than a refusal — see `typedefs/dispute.ts::hasEvidenceShape`.
 */
export const disputeSchema = z.object({
  finding: z.string(),
  evidence: z.string(),
  reason: z.string().default(''),
})
export type TDispute = Readonly<z.infer<typeof disputeSchema>>

export const buildOutputSchema = contextEnvelopeSchema.extend({
  /**
   * REQUIRED, not defaulted: this is the builder's claim about what it
   * touched, and `diff_matches_claims` checks it. A default would let an
   * omission read as "I changed nothing", which is a claim nobody made.
   */
  changed_files: z.array(z.string()),
  /** consumed by the git commit activityRun */
  commit_message: z.string().default(''),
  /** findings answered with evidence rather than a change; empty on a plain build */
  disputes: z.array(disputeSchema).default([]),
})
export type TBuildOutput = Readonly<z.infer<typeof buildOutputSchema>>
export const buildOutput = envelopeSpec('BuildOutput', buildOutputSchema)

export const scoutFindingSchema = z.object({
  file: z.string(),
  note: z.string().default(''),
})
export type TScoutFinding = Readonly<z.infer<typeof scoutFindingSchema>>

export const scoutOutputSchema = contextEnvelopeSchema.extend({
  /** REQUIRED: what the scout found. An empty recon has to be asserted. */
  findings: z.array(scoutFindingSchema),
})
export type TScoutOutput = Readonly<z.infer<typeof scoutOutputSchema>>
export const scoutOutput = envelopeSpec('ScoutOutput', scoutOutputSchema)

/**
 * How a researcher came to know something.
 *
 * The distinction every one of the research disciplines insists on: what was
 * OBSERVED differs from what is DOCUMENTED, and both differ from what was
 * INFERRED. Collapsing them is how "the docs say it retries" becomes "it
 * retries" and then becomes a design that assumes retries nobody has seen.
 */
export const SOURCE_CLASSES = ['observed', 'documented', 'inferred'] as const

export const researchFindingSchema = z.object({
  /** what is true, stated so it can be contradicted */
  finding: z.string(),
  /** how it is known: a path:line, a URL, a command and its output, a dataset */
  evidence: z.string().default(''),
  source: z.enum(SOURCE_CLASSES).default('inferred'),
  /**
   * How sure, and why — low confidence with a reason is useful; a bare number
   * is not. Defaulted low: a finding that forgot to say must not read as sure.
   */
  confidence: z.enum(['low', 'medium', 'high']).default('low'),
  /**
   * Sources that disagree with this one. Triangulation is in every brief, and
   * a contradiction that is found and then dropped is worse than one never
   * looked for, because the next reader has no idea it existed.
   */
  contradicts: z.string().default(''),
})
export type TResearchFinding = Readonly<z.infer<typeof researchFindingSchema>>

/**
 * One schema for every research discipline, technical through to data.
 *
 * They investigate different subjects and read different sources, but they
 * answer the same contract: here is what is true, here is how I know, here is
 * how sure I am, and here is what I could not settle. The step name already
 * records which discipline asked, so a field repeating it would be a second
 * source of truth. Six near-identical schemas would drift apart within a
 * month, and every consumer would have to learn all six.
 */
export const researchOutputSchema = contextEnvelopeSchema.extend({
  /** REQUIRED: what was established. Research that found nothing must say so. */
  findings: z.array(researchFindingSchema),
  /**
   * What would change the answer, and what nobody looked at. Named separately
   * from `unresolved` because that is "I could not answer this"; this is "I
   * did not look here, and you should know the shape of the hole".
   */
  not_investigated: z.array(z.string()).default([]),
})
export type TResearchOutput = Readonly<z.infer<typeof researchOutputSchema>>
export const researchOutput = envelopeSpec(
  'ResearchOutput',
  researchOutputSchema,
)

/** One screen, view or component, specified closely enough to build. */
export const designSurfaceSchema = z.object({
  /** what it is called, as a person would refer to it */
  name: z.string(),
  /** structure, grouping, ordering, responsive behaviour */
  layout: z.string().default(''),
  /** every meaningful state: loading, empty, error, disabled, success */
  states: z.array(z.string()).default([]),
  /** keyboard behaviour, focus order, labelling, announcements */
  accessibility: z.string().default(''),
  /** components, tokens and patterns reused rather than invented */
  reuses: z.array(z.string()).default([]),
})
export type TDesignSurface = Readonly<z.infer<typeof designSurfaceSchema>>

/**
 * A design somebody else can implement without inventing UX decisions.
 *
 * `unspecified` is required rather than optional, because the brief turns on
 * it: a spec that silently omits a state hands that decision to whoever
 * implements it, unknowingly. Saying "this is deliberately open" is a design
 * decision; saying nothing is an accident with the same appearance.
 */
export const uxDesignOutputSchema = contextEnvelopeSchema.extend({
  surfaces: z.array(designSurfaceSchema),
  /** what was decided to satisfy a requirement, versus what research dictated */
  design_decisions: z.array(decisionSchema).default([]),
  /** deliberately left open, and what would settle it */
  unspecified: z.array(z.string()).default([]),
})
export type TUxDesignOutput = Readonly<z.infer<typeof uxDesignOutputSchema>>
export const uxDesignOutput = envelopeSpec('UxDesignOutput', uxDesignOutputSchema)

/** One step in a planned chain, with the wiring a DAG will later need. */
export const plannedStepSchema = z.object({
  /** MUST be a pi-crust step name — `steps_valid` rejects anything else */
  step: z.string(),
  /** why this step earns its place, in terms of the outcome */
  because: z.string().default(''),
  /**
   * Which earlier steps it needs the output of. Recorded now and unused: the
   * runner is sequential today, so this is the DAG's evidence being gathered
   * before the DAG exists rather than reconstructed afterwards.
   */
  depends_on: z.array(z.string()).default([]),
  /** what should reach it from those steps, in words */
  inputs: z.string().default(''),
})
export type TPlannedStep = Readonly<z.infer<typeof plannedStepSchema>>

/**
 * A workflow, chosen rather than assumed.
 *
 * `steps` is ordered and is the authority on execution order; `plan` carries
 * the same steps with their reasons and dependencies. Two fields for one list
 * is a real cost, accepted because the ordered list is what a machine runs
 * and the annotated one is what a person reads — and conflating them put
 * prose where a `--steps` argument has to go.
 */
export const operatorPlanOutputSchema = contextEnvelopeSchema.extend({
  /** REQUIRED: the chain, in execution order. Empty means "nothing to do". */
  steps: z.array(z.string()),
  plan: z.array(plannedStepSchema).default([]),
  /** what the run is for, in the operator's words — the outcome it aimed at */
  outcome: z.string().default(''),
  /** steps considered and rejected, so nobody re-proposes them */
  excluded: z.array(z.string()).default([]),
  /** how a reader knows the chain finished the job */
  completion: z.string().default(''),
})
export type TOperatorPlanOutput = Readonly<
  z.infer<typeof operatorPlanOutputSchema>
>
export const operatorPlanOutput = envelopeSpec(
  'OperatorPlanOutput',
  operatorPlanOutputSchema,
)

/** One thing the request (or plan) asked for, and whether it is there. */
export const reviewFindingSchema = z.object({
  /** the ask, in the requester's words */
  requirement: z.string(),
  met: z.boolean(),
  /** where it lives, or what is missing */
  evidence: z.string().default(''),
})
export type TReviewFinding = Readonly<z.infer<typeof reviewFindingSchema>>

/** Confirmation that what was built is what was asked for — not a test run. */
export const reviewOutputSchema = contextEnvelopeSchema.extend({
  /** REQUIRED: the verdict. A defaulted verdict is not a verdict. */
  approved: z.boolean(),
  /**
   * REQUIRED: the rulings the verdict rests on. Defaulted to empty, a
   * reviewer that forgot to report them would pass `verdict_consistent`
   * with nothing unmet — an approval backed by no reasoning at all.
   */
  findings: z.array(reviewFindingSchema),
  /** REQUIRED: what must change before approval; `[]` has to be deliberate. */
  blocking: z.array(z.string()),
})
export type TReviewOutput = Readonly<z.infer<typeof reviewOutputSchema>>
export const reviewOutput = envelopeSpec('ReviewOutput', reviewOutputSchema)

/** Where the write-up of a completed change landed. */
export const documentOutputSchema = contextEnvelopeSchema.extend({
  /** the doc in the repo, e.g. app_docs/<run_id>_<slug>.md */
  document_path: z.string().default(''),
  /**
   * REQUIRED: documenting nothing is a legitimate outcome and a decision,
   * so it is stated as `[]` rather than arrived at by omission.
   */
  documented_files: z.array(z.string()),
  commit_message: z.string().default(''),
})
export type TDocumentOutput = Readonly<z.infer<typeof documentOutputSchema>>
export const documentOutput = envelopeSpec(
  'DocumentOutput',
  documentOutputSchema,
)

/**
 * A deterministic result, shaped as an envelope so an agent can consume it.
 *
 * Agents hand each other typed envelopes; code blocks return TQualityResult.
 * This is the adapter, so a failing lint or test run flows back into the
 * builder through exactly the same door a tester agent's report used to — the
 * workflow script is the only thing that knows the difference.
 */

/**
 * 1.2 Identify — what outcome is wanted, and how success will be recognised.
 *
 * `success_criteria` is the field the whole lifecycle hinges on. It is set
 * here, carried forward unchanged, ruled against by `review`, and checked
 * again by the human at launch. Without it, "did we build the right thing"
 * has no answer but opinion.
 */
export const identifyOutputSchema = contextEnvelopeSchema.extend({
  /** the outcome wanted, without prescribing how */
  outcome: z.string(),
  /** REQUIRED: how success is recognised, in observable terms */
  success_criteria: z.array(z.string()),
  /** what this does NOT cover — scope is a boundary, not a wish */
  out_of_scope: z.array(z.string()),
  requirements: z.array(z.string()),
  constraints: z.array(z.string()),
})
export type TIdentifyOutput = Readonly<z.infer<typeof identifyOutputSchema>>
export const identifyOutput = envelopeSpec('IdentifyOutput', identifyOutputSchema)

/**
 * 1.2b Diagnose — what is ACTUALLY happening, and why.
 *
 * A bug report is a symptom, usually written by someone who cannot see the
 * code. Running `identify` on one produces a confident outcome statement
 * derived from a guess, which is the exact failure this stage exists to stop:
 * nothing downstream can tell that the cause was invented rather than found.
 *
 * `reproduced: false` is a SUCCESS. Failing to reproduce is a real finding and
 * often the most valuable one — it says the report is incomplete, intermittent,
 * or environmental, and it sends a question back to a human instead of sending
 * a fabricated root cause forward to a builder.
 *
 * `confidence` is required and separate from `status` for the same reason:
 * "I found it" and "this is my best guess" are different claims, and a builder
 * that cannot tell them apart will treat both as instructions.
 */
export const diagnosisOutputSchema = contextEnvelopeSchema.extend({
  /** could the reported behaviour be made to happen on purpose */
  reproduced: z.boolean(),
  /** the exact sequence that triggers it — empty when it could not be reproduced */
  steps_to_reproduce: z.array(z.string()),
  /** the mechanism, not the symptom: what the code does that produces this */
  root_cause: z.string(),
  /** what was observed that supports the cause — logs, output, failing input */
  evidence: z.array(z.string()),
  /** how sure, and honestly: a guess labelled as a finding is the worst output */
  confidence: z.enum(['confirmed', 'likely', 'unproven']),
  /** paths the cause lives in, for whoever fixes it */
  suspect_files: z.array(z.string()),
  /**
   * A test that fails BECAUSE of this bug, if one can exist.
   *
   * Steps are required; a test is desired. A failing test turns "it should not
   * do that" into something a builder can finish against and a reviewer can
   * check, and it keeps the bug fixed after everyone has forgotten it.
   *
   * It is not always possible — the cause may be outside the codebase,
   * non-deterministic, or only intermittently reproducible — so `''` is a
   * legitimate answer, and the reason belongs in `assumptions` or `unresolved`
   * rather than in a test that pretends to prove something.
   */
  reproducing_test: z.string(),
})
export type TDiagnosisOutput = Readonly<z.infer<typeof diagnosisOutputSchema>>
export const diagnosisOutput = envelopeSpec(
  'DiagnosisOutput',
  diagnosisOutputSchema,
)

/**
 * 1.3 Conceptualize — what the solution must MEAN and DO.
 *
 * Logical, never physical. `candidates` with `rejected_because` is what stops
 * the chosen approach looking inevitable to everyone downstream: an approach
 * nobody recorded rejecting gets re-proposed at the worst moment.
 */
export const candidateSchema = z.object({
  approach: z.string(),
  rejected_because: z.string(),
})
export type TCandidate = Readonly<z.infer<typeof candidateSchema>>

export const conceptualizeOutputSchema = contextEnvelopeSchema.extend({
  /** the responsibilities and relationships, in domain language */
  logical_architecture: z.string(),
  capabilities: z.array(z.string()),
  /** what must hold, whatever the implementation turns out to be */
  invariants: z.array(z.string()),
  candidates: z.array(candidateSchema),
  /** what must be knowable about this in operation, decided before building */
  observability_questions: z.array(z.string()),
})
export type TConceptualizeOutput = Readonly<
  z.infer<typeof conceptualizeOutputSchema>
>
export const conceptualizeOutput = envelopeSpec(
  'ConceptualizeOutput',
  conceptualizeOutputSchema,
)

/**
 * 2.2 Design — how the logical architecture physically exists here.
 *
 * `observability` answers the questions `conceptualize` raised, with the
 * cheapest reliable evidence rather than everything that could be logged.
 */
export const designOutputSchema = contextEnvelopeSchema.extend({
  /** components, interfaces, schemas, data flow — the physical shape */
  physical_architecture: z.string(),
  /** signal -> what question it answers; bounded on purpose */
  observability: z.array(z.string()),
  /** decisions durable enough that someone would otherwise rediscover them */
  records_to_write: z.array(z.string()),
})
export type TDesignOutput = Readonly<z.infer<typeof designOutputSchema>>
export const designOutput = envelopeSpec('DesignOutput', designOutputSchema)

/**
 * 2.0 POC — an experiment, not an early implementation.
 *
 * `hypothesis` is required and comes FIRST, because a POC that starts without
 * one is a demonstration that code can be written. `supported` may be false
 * and that is a successful POC: disproving an architecture early is the
 * cheapest outcome this stage can produce.
 */
export const pocOutputSchema = contextEnvelopeSchema.extend({
  hypothesis: z.string(),
  /** what would have supported or disproved it, decided before experimenting */
  evidence_sought: z.string(),
  supported: z.boolean(),
  /** what to throw away — a POC's code is not production code */
  discard: z.array(z.string()),
})
export type TPocOutput = Readonly<z.infer<typeof pocOutputSchema>>
export const pocOutput = envelopeSpec('PocOutput', pocOutputSchema)

export const verifyOutputSchema = envelopeBaseSchema.extend({
  /**
   * REQUIRED, both of them. Code builds this envelope, so the compiler
   * enforces what the schema states, and a verification that forgot to say
   * whether it passed must not read as a failure-free pass.
   */
  passed: z.boolean(),
  failures: z.array(z.string()),
})
export type TVerifyOutput = Readonly<z.infer<typeof verifyOutputSchema>>
export const verifyOutput = envelopeSpec('VerifyOutput', verifyOutputSchema)

/**
 * A change-set shaped as an envelope so an agent can be handed it directly.
 * Same adapter idea as TVerifyOutput: code computes the diff, the documenter
 * consumes it through the one door every agent handoff uses.
 */
export const changesOutputSchema = envelopeBaseSchema.extend({
  /** "<ref> @ <commit> — <reason>" */
  base: z.string().default(''),
  changed_files: z.array(z.string()).default([]),
  insertions: z.number().default(0),
  deletions: z.number().default(0),
  stat: z.string().default(''),
  /** read this for the full diff */
  diff_path: z.string().default(''),
})
export type TChangesOutput = Readonly<z.infer<typeof changesOutputSchema>>
export const changesOutput = envelopeSpec('ChangesOutput', changesOutputSchema)
