/**
 * Stopping for a person, without anything waiting on a prompt.
 *
 * A gated run writes down what a human has to decide, records it, and EXITS.
 * Nothing blocks. A process sitting on `readline` in an
 * unattended run is the 1Password failure in another costume: the work was
 * finished, the chain had one activity left, and sixty seconds of silence killed
 * it because nobody was at the keyboard.
 *
 * The answer comes back out of band — `approve`, `reject`, `answer` — and the
 * run is picked up with `--resume`, which already knows how to skip the activity runs
 * that succeeded. A human's answer enters the next stage's context as a FACT
 * attributed to them, not as an agent's inference.
 *
 * `--approve-after identify,design` opts into stage approvals. The lifecycle
 * also requires gates for unresolved authority questions, repeated regressions,
 * unaccepted work at delivery, and operator-recoverable delivery refusals.
 */

import { join } from 'node:path'
import { z } from 'zod'
import type {
  TActivityContext,
  TEnvelopeBase,
  TRun,
  TTreeWarning,
} from '../../../../lib/contracts'
import {
  blockingQuestions,
  contextEnvelopeSchema,
  questionsOf,
  stanceFor,
  TRUST_PROVISIONAL,
} from '../../../../lib/contracts'
import { fileExists, readText, writeText } from '../../../../lib/system'
import { recipeArgv, resumeArgv, shellLine } from '../../../cli'
import type { TDecisionAnswer } from '../typedefs/decision-answer'

export { ANSWER_RECORD_FILENAME } from '../typedefs/decision-answer'

export { blockingQuestions }
export const DECISION_FILENAME = 'decision-request.md'
export const ANSWER_FILENAME = 'decision-answer.md'
const acceptanceGateSchema = z.object({
  kind: z.literal('acceptance'),
  activity: z.string(),
  detail: z.string(),
  opened_at: z.string().datetime(),
})

/** An answer counts only after the acceptance gate it is settling opened. */
export const acceptanceDecision = (
  gatePayload: unknown,
  answer: TDecisionAnswer | undefined,
) => {
  const gate = acceptanceGateSchema.safeParse(gatePayload)
  if (!gate.success) return undefined
  return {
    gate: gate.data,
    answer:
      answer !== undefined &&
      Date.parse(answer.at) > Date.parse(gate.data.opened_at)
        ? answer
        : undefined,
  }
}

/**
 * Why a run stopped for a person. Delivery needs no answer: the operator
 * resolves the refused commit, authentication or push and resumes the run.
 *
 * `activity`, not `stage`. The field has always held the name of one
 * Activity, and it was called `stage` back when a Stage was not a thing the
 * engine had. It is now, which made one word mean two levels of the model —
 * including, briefly, in a single trace payload carrying both.
 */
export type TGateReason =
  | Readonly<{ kind: 'requested'; activity: string }>
  /**
   * A question the chain may not answer for itself at this trust level.
   *
   * Named for the act rather than for the old field: at low it is anything
   * consequential, at medium it is a question with no defensible answer or
   * one whose action reaches beyond this run, and at high it never fires.
   */
  | Readonly<{
      kind: 'escalated'
      activity: string
      questions: readonly string[]
    }>
  | Readonly<{ kind: 'deadlocked'; activity: string; detail: string }>
  | Readonly<{ kind: 'acceptance'; activity: string; detail: string }>
  /**
   * An agent chose the chain and is about to run it.
   *
   * Its own kind rather than a consequential question, because it is not a
   * question: nothing is missing and nothing needs answering. What is being
   * put to you is narrower — here is the work I propose to do on your behalf
   * and on your budget, shall I.
   */
  | Readonly<{ kind: 'plan'; activity: string; activities: readonly string[] }>
  | Readonly<{
      kind: 'delivery'
      activity: string
      cause: 'uncommitted' | 'forge'
      /** Non-empty only when cause is `uncommitted`. */
      outstanding: readonly TTreeWarning[]
      /** Non-empty only when cause is `forge`. */
      refusal: string
    }>

export const parseApproveAfter = (
  flag: string | undefined,
): readonly string[] =>
  (flag ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)

/**
 * What a stage decided for itself because the dial let it.
 *
 * Reported at the end of the run rather than buried in an envelope: a chain
 * that answered five of its own questions has made five decisions nobody
 * reviewed, and the whole bargain of a raised trust level is that you get to
 * see them afterwards.
 */
export const selfAnswered = (
  envelope: TEnvelopeBase | undefined,
  level: number,
): readonly Readonly<{ question: string; answer: string }>[] =>
  questionsOf(envelope)
    .filter(
      (question) =>
        question.consequential &&
        stanceFor({
          level,
          answerable: question.provisional_answer.trim() !== '',
          beyondThisRun: question.beyond_this_run,
          consequential: true,
        }) === 'answer-provisionally',
    )
    .map((question) => ({
      question: question.question,
      answer:
        question.provisional_answer === ''
          ? '(no answer offered — the stage proceeded without one)'
          : question.provisional_answer,
    }))

/**
 * Should the run stop here, and why?
 *
 * Order matters: a consequential question outranks a requested gate, because
 * one is a thing nobody may invent and the other is a thing you asked to see.
 *
 * `hasSuccessor` is why the unprompted stop is justified at all. The rule it
 * enforces is the Authority Rule — a LATER stage would otherwise have to
 * invent the answer. After a successful last stage there is no later stage,
 * so the question is a finding to report. A FAILED stage is itself unfinished:
 * answering lets that stage run again, even when it ends the chain.
 *
 * A gate you asked for is different, and still fires on the last stage: you
 * asked to see that stage's output before anything continued, and "nothing
 * continued" is an answer you are entitled to give rather than one the chain
 * gives for you.
 */
export const gateReason = (params: {
  readonly activity: string
  readonly envelope: TEnvelopeBase | undefined
  readonly approveAfter: readonly string[]
  /** false on the final stage of the chain — nobody downstream can invent anything */
  readonly hasSuccessor: boolean
  /** how much the agents are trusted to answer for themselves */
  readonly trust: number
}): TGateReason | undefined => {
  const questions = blockingQuestions(params.envelope, params.trust)
  if (
    questions.length > 0 &&
    (params.hasSuccessor || params.envelope?.status === 'fail')
  ) {
    return { kind: 'escalated', activity: params.activity, questions }
  }
  if (params.approveAfter.includes(params.activity)) {
    return { kind: 'requested', activity: params.activity }
  }
  return undefined
}

/**
 * The exact command that picks this run back up — this invocation, plus
 * `--run-id` and `--resume`.
 *
 * Rebuilt from the argv the run was launched with, because flags are NOT
 * stored with the session. `--approve-after plan` is a property of the
 * invocation, so a developer who resumes without repeating it loses the gate
 * they asked for and only finds out by the chain sailing past it.
 *
 * Printed as the recipe, not as the path argv carries. The path is absolute,
 * which is correct and unreadable, and relative to nothing a stamped
 * repository contains — the runtime ships with the package. A command printed
 * to be copied has to be one that runs from where the developer is standing.
 *
 * The run's own resume flags are stripped and re-appended by `resumeArgv`
 * rather than kept in place, so the second gate of an already-resumed run
 * prints the same line as the first. Leaving them where they sat produced
 * `--resume` before `--run-id` on one gate and after it on the next — the
 * same command, read as two different ones by whoever is comparing them.
 */
export const resumeInvocation = (
  argv: readonly string[],
  runId: string,
): string => {
  const resumed = ['bun', ...resumeArgv(argv, runId)]

  return shellLine(recipeArgv(resumed) ?? resumed)
}

/** Every way out of a gate, with what each one costs you. */
export const decisionOptions = (
  runId: string,
  resume: string,
  kind?: string,
): readonly string[] =>
  kind === 'acceptance'
    ? [
        `crust approve ${runId}`,
        '    accept the run over unresolved findings and open the pull request',
        `crust answer  ${runId} --file answers.md`,
        '    accept the run with your answer and open the pull request',
        `crust reject  ${runId} --note "..."`,
        '    cancel the pull request and end the run as not accepted',
        '',
        `    ${resume}`,
      ]
    : [
        `crust answer  ${runId} --file answers.md`,
        '    your text enters the next stage as a FACT attributed to you',
        `crust reject  ${runId} --note "..."`,
        '    send the stage back to redo its work with a correction',
        `crust approve ${runId}`,
        '    continue WITHOUT answering — the questions stay open in the record',
        '',
        'then pick it up where it stopped (nothing already green is re-run):',
        `    ${resume}`,
      ]

const launchFlagsExplanation =
  'That line repeats the flags this run was launched with. They are NOT ' +
  'stored with the session — a gate you asked for with `--approve-after` is ' +
  'a property of the invocation, so dropping it means the next gate never ' +
  'fires.\n\n'

/** What the human reads. Written to the handoff directory, never to stdout. */
export const renderDecisionRequest = (
  reason: TGateReason,
  runId: string,
  resume: string,
): string => {
  if (reason.kind === 'delivery') {
    const why =
      reason.cause === 'uncommitted'
        ? 'Git refused these commits, and one retry at delivery was refused too. ' +
          'Nothing has been pushed and no pull request is open.\n\n' +
          reason.outstanding
            .map(
              (warning) =>
                `- ${warning.activities.join(', ')}: ${warning.paths.length} path(s) — ${warning.note}`,
            )
            .join('\n')
        : `Delivery was refused: ${reason.refusal}. Nothing reached the forge.`
    return (
      `# Waiting for you\n\nRun \`${runId}\` stopped while delivering \`${reason.activity}\`.\n\n` +
      `## Why\n\n${why}\n\n## What happens next\n\n` +
      'No answer is needed. Resolve what the error names so it can complete. ' +
      'For a signing or SSH agent such as 1Password, be present to approve its prompt. ' +
      'Resuming retries each refused commit once under your own signing configuration, ' +
      'then pushes and opens the pull request.\n\n' +
      `\`\`\`bash\n${resume}\n\`\`\`\n\n` +
      launchFlagsExplanation
    )
  }
  if (reason.kind === 'acceptance') {
    return (
      `# Waiting for you\n\nRun \`${runId}\` has not been accepted for \`${reason.activity}\`.\n\n` +
      `## Why\n\n${reason.detail}\n\n## What happens next\n\n` +
      'Approve opens the pull request over the unresolved findings. Answer also accepts the run. ' +
      'Reject cancels the pull request and ends the run as not accepted; it does not revise the work. ' +
      'Delivery may stop again if a commit or push is refused.\n\n' +
      `\`\`\`text\n${decisionOptions(runId, resume, reason.kind).join('\n')}\n\`\`\`\n\n` +
      launchFlagsExplanation
    )
  }
  const head = `# Waiting for you\n\nRun \`${runId}\` stopped after \`${reason.activity}\`.\n\n`
  const body =
    reason.kind === 'plan'
      ? '## The chain it chose\n\n' +
        reason.activities
          .map((activity, index) => `${index + 1}. \`${activity}\``)
          .join('\n') +
        '\n\nNothing has run yet beyond the planning itself. Approving runs ' +
        'exactly these activities, in this order; rejecting with a note sends the ' +
        'operator back to choose again, and your note is what it must honour ' +
        'the second time.\n\nRaise `--trust-level` to 50 or above and a chain ' +
        'like this one runs without stopping here.\n'
      : reason.kind === 'escalated'
        ? '## Why\n\nThat stage reached questions it may not settle at this trust ' +
          'level — either it had no answer it could defend, or acting would ' +
          'reach beyond what discarding this run would undo:\n\n' +
          reason.questions.map((question) => `- ${question}`).join('\n') +
          '\n'
        : reason.kind === 'deadlocked'
          ? `## Why\n\n${reason.detail}\n`
          : '## Why\n\nYou asked to approve this stage before the chain ' +
            'continued.\n'
  return (
    `${head}${body}\n## What happens next\n\n` +
    '```bash\n' +
    `crust answer  ${runId} --file answers.md   # your text enters the next stage as a FACT attributed to you\n` +
    `crust reject  ${runId} --note "..."        # send the stage back to redo its work with a correction\n` +
    `crust approve ${runId}                     # continue WITHOUT answering — the questions stay open\n` +
    '```\n\n' +
    'Then pick it up where it stopped:\n\n' +
    `\`\`\`bash\n${resume}\n\`\`\`\n\n` +
    launchFlagsExplanation +
    'Nothing is running. The run resumes from the first activityRun that has not ' +
    'succeeded, so answering costs only the stages that still have to happen.\n'
  )
}

export const decisionPath = (handoffDir: string): string =>
  join(handoffDir, DECISION_FILENAME)

export const answerPath = (handoffDir: string): string =>
  join(handoffDir, ANSWER_FILENAME)

export const writeDecisionRequest = (
  handoffDir: string,
  reason: TGateReason,
  runId: string,
  resume: string,
): string => {
  const path = decisionPath(handoffDir)
  writeText(path, renderDecisionRequest(reason, runId, resume))
  return path
}

/**
 * The human's answer, as a fact the next stage can carry.
 *
 * Attributed rather than anonymous: a later stage reading "the retention
 * window is 90 days" should be able to tell that a person said so, not that
 * an agent inferred it from a filename.
 */
export const answerAsFact = (
  handoffDir: string,
  engineer: string,
): Readonly<{ fact: string; evidence: string }> | undefined => {
  const path = answerPath(handoffDir)
  if (!fileExists(path)) {
    return undefined
  }
  const text = readText(path).trim()
  return text === ''
    ? undefined
    : { fact: text, evidence: `answered by ${engineer} in ${path}` }
}

/** Keep the person's answer available even when a replay replaces an input. */
export const withDecisionAnswer =
  (fact: Readonly<ReturnType<typeof answerAsFact>>) =>
  (ctx: TActivityContext): TActivityContext => {
    if (fact === undefined) return ctx

    const withFact = (envelope: TEnvelopeBase | undefined): TEnvelopeBase => {
      const parsed =
        envelope === undefined
          ? undefined
          : contextEnvelopeSchema.safeParse(envelope)
      const facts = parsed?.success ? parsed.data.facts : []
      const updated = {
        ...(envelope ?? {
          status: 'success' as const,
          summary: 'The engineer answered the human gate',
          artifacts: [],
          notes_for_next_agent: '',
          decisions: [],
          assumptions: [],
          unresolved: [],
          risks: [],
          objective_met: { met: true, evidence: fact.evidence },
          regress_to: { activity: '', because: '' },
        }),
        facts: [
          ...facts.filter(
            (one) => one.fact !== fact.fact || one.evidence !== fact.evidence,
          ),
          fact,
        ],
      }
      return updated
    }

    return {
      ...ctx,
      previous: withFact(ctx.previous),
      upstream: ctx.upstream.map((one) => ({
        ...one,
        envelope: withFact(one.envelope),
      })),
    }
  }

export type TSelfAnswered = Readonly<{
  activity: string
  question: string
  answer: string
}>

/**
 * Everything this run decided for itself, read back from its own trace.
 *
 * From the trace rather than from an accumulator threaded through the fold:
 * the events are written as they happen, so a run that crashed half way still
 * has the record, and the report cannot drift from what was traced.
 */
export const selfAnsweredIn = (
  run: TRun,
  trust: number,
): readonly TSelfAnswered[] =>
  run.tracer
    .eventsNamed(run.runId, 'self_answered')
    .flatMap((payload) => {
      const entry = payload as Partial<TSelfAnswered> & { trust?: number }
      return entry.question === undefined
        ? []
        : [
            {
              activity: entry.activity ?? '',
              question: entry.question,
              answer: entry.answer ?? '',
            },
          ]
    })
    .filter(() => trust >= TRUST_PROVISIONAL)
