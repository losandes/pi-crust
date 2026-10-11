/**
 * Stopping for a person, without anything waiting on a prompt.
 *
 * A gated run completes the stage, writes down what a human has to decide,
 * records it, and EXITS. Nothing blocks. A process sitting on `readline` in an
 * unattended run is the 1Password failure in another costume: the work was
 * finished, the chain had one step left, and sixty seconds of silence killed
 * it because nobody was at the keyboard.
 *
 * The answer comes back out of band — `approve`, `reject`, `answer` — and the
 * run is picked up with `--resume`, which already knows how to skip the phases
 * that succeeded. A human's answer enters the next stage's context as a FACT
 * attributed to them, not as an agent's inference.
 *
 * Opt-in, always. `--approve-after identify,design` names the stages whose
 * output you want to see before the chain carries on. A run with no flag
 * behaves exactly as it did before.
 *
 * Two escalations happen WITHOUT being asked for, because the lifecycle
 * requires them: a consequential unresolved question reaching a stage that
 * would otherwise invent the answer (the Authority Rule), and a second
 * regression to one stage (no agent is going to settle that).
 */

import { join } from 'node:path'
import { fileExists, readText, writeText } from '../data/files'
import type { TEnvelopeBase } from '../typedefs/envelope'
import type { TQuestion } from '../typedefs/envelope'
import type { TRun } from '../typedefs/run'
import { contextEnvelopeSchema } from '../typedefs/envelope'
import { TRUST_PROVISIONAL, stanceFor } from '../typedefs/trust'

export const DECISION_FILENAME = 'decision-request.md'
export const ANSWER_FILENAME = 'decision-answer.md'

/**
 * Why a run stopped for a person.
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
  | Readonly<{ kind: 'escalated'; activity: string; questions: readonly string[] }>
  | Readonly<{ kind: 'deadlocked'; activity: string; detail: string }>
  /**
   * An agent chose the chain and is about to run it.
   *
   * Its own kind rather than a consequential question, because it is not a
   * question: nothing is missing and nothing needs answering. What is being
   * put to you is narrower — here is the work I propose to do on your behalf
   * and on your budget, shall I.
   */
  | Readonly<{ kind: 'plan'; activity: string; steps: readonly string[] }>

export const parseApproveAfter = (flag: string | undefined): readonly string[] =>
  (flag ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)

const questionsOf = (
  envelope: TEnvelopeBase | undefined,
): readonly TQuestion[] => {
  const parsed =
    envelope === undefined
      ? undefined
      : contextEnvelopeSchema.safeParse(envelope)
  return parsed === undefined || !parsed.success ? [] : parsed.data.unresolved
}

/**
 * The questions that STOP this run, given how much the agents are trusted.
 *
 * At the default level a question stops the run only when the stage had no
 * defensible answer for it, or when answering would act beyond what
 * discarding this run would undo. Everything else is decided, said out loud,
 * and listed again at the end. At the top of the dial nothing stops it; at
 * the bottom everything does.
 */
export const blockingQuestions = (
  envelope: TEnvelopeBase | undefined,
  level: number,
): readonly string[] =>
  questionsOf(envelope)
    .filter(
      (question) =>
        stanceFor({
          level,
          answerable: question.provisional_answer.trim() !== '',
          beyondThisRun: question.beyond_this_run,
          consequential: question.consequential,
        }) === 'gate',
    )
    .map((question) => question.question)

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
 * invent the answer. After the last stage there is no later stage, so the
 * premise is false: the question is a finding to report, not a decision
 * blocking anything. Stopping there produced a completed nine-stage run that
 * exited `waiting` and offered a resume command with nothing left to resume.
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
  if (questions.length > 0 && params.hasSuccessor) {
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
 * The script path is normalised back to its `.pi-crust/...` form: argv carries an
 * absolute path, which is correct and unreadable, and a command printed to be
 * copied should look like the one that was typed.
 */
export const resumeInvocation = (
  argv: readonly string[],
  runId: string,
): string => {
  const script = argv[1] ?? ''
  const marker = script.lastIndexOf('/.pi-crust/')
  const relative = marker === -1 ? script : script.slice(marker + 1)
  const given = argv.slice(2)
  /*
   * The run's own resume flags are stripped and re-appended rather than kept
   * in place, so the second gate of an already-resumed run prints the same
   * line as the first. Leaving them where they sat produced `--resume` before
   * `--run-id` on one gate and after it on the next — the same command, read
   * as two different ones by whoever is comparing them.
   */
  /*
   * Quoted the way a shell needs, because this line exists to be pasted. The
   * prompt is one argv entry full of spaces and full stops; unquoted it
   * becomes six arguments and the command fails in a way that looks like
   * crust's fault.
   */
  const quoted = (arg: string): string =>
    /^[\w./:=-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '\\"')}"`
  const carried = given.filter((arg, index) => {
    const previous = given[index - 1]
    return arg !== '--run-id' && previous !== '--run-id' && arg !== '--resume'
  })
  return [
    'bun',
    relative,
    ...carried.map(quoted),
    '--run-id',
    runId,
    '--resume',
  ].join(' ')
}

/** Every way out of a gate, with what each one costs you. */
export const decisionOptions = (
  runId: string,
  resume: string,
): readonly string[] => [
  `just crust answer  ${runId} --file answers.md`,
  '    your text enters the next stage as a FACT attributed to you',
  `just crust reject  ${runId} --note "..."`,
  '    send the stage back to redo its work with a correction',
  `just crust approve ${runId}`,
  '    continue WITHOUT answering — the questions stay open in the record',
  '',
  'then pick it up where it stopped (nothing already green is re-run):',
  `    ${resume}`,
]

/** What the human reads. Written to the handoff directory, never to stdout. */
export const renderDecisionRequest = (
  reason: TGateReason,
  runId: string,
  resume: string,
): string => {
  const head = `# Waiting for you\n\nRun \`${runId}\` stopped after \`${reason.activity}\`.\n\n`
  const body =
    reason.kind === 'plan'
      ? '## The chain it chose\n\n' +
        reason.steps.map((step, index) => `${index + 1}. \`${step}\``).join('\n') +
        '\n\nNothing has run yet beyond the planning itself. Approving runs ' +
        'exactly these steps, in this order; rejecting with a note sends the ' +
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
    `just crust answer  ${runId} --file answers.md   # your text enters the next stage as a FACT attributed to you\n` +
    `just crust reject  ${runId} --note "..."        # send the stage back to redo its work with a correction\n` +
    `just crust approve ${runId}                     # continue WITHOUT answering — the questions stay open\n` +
    '```\n\n' +
    'Then pick it up where it stopped:\n\n' +
    `\`\`\`bash\n${resume}\n\`\`\`\n\n` +
    'That line repeats the flags this run was launched with. They are NOT ' +
    'stored with the session — a gate you asked for with `--approve-after` is ' +
    'a property of the invocation, so dropping it means the next gate never ' +
    'fires.\n\n' +
    'Nothing is running. The run resumes from the first phase that has not ' +
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
