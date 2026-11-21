/**
 * `runReviseLoop`, driven end to end (COVERAGE-WORKFLOW-DRIVERS.md).
 *
 * `fakeActivity` cannot stand in here: the loop builds its reviser and its
 * re-asked reviewers itself, from `run.cfg`, through the same
 * `runnableActivities`/`agentActivity` every real run uses — there is no
 * parameter to hand it a literal `TActivity`. What stands in instead is the
 * real resume mechanism: `run.resume` names the instances the loop would
 * otherwise spawn an agent for, with the envelope each one would have
 * replayed already written to `{sessionDir}/{agent}/envelope.json` — the
 * legacy-session fallback a live `--resume` still reads. No agent is spawned
 * anywhere in this file.
 */

import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TActivityContext,
  TEnvelopeBase,
  TPiCrustConfig,
  TRun,
} from '../../../../lib/contracts'
import {
  crustConfigSchema,
  DEFAULT_ACTIVITY_OPTIONS,
} from '../../../../lib/contracts'
import { runWithTracer } from '../../../../testing/fake-activity'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import { REPORT_FILENAME } from '../../../gates'
import { attemptLedger } from './attempts'
import { runReviseLoop } from './revise-loop'

const capturedTerminal = () => {
  silenceTerminal()
  return { [Symbol.dispose]: restoreTerminal }
}

const PROMPT_ENGINEERING = { system: 's.md', user: 'u.md' }

const cfgWith = (
  activities: readonly Record<string, unknown>[],
): TPiCrustConfig => crustConfigSchema.parse({ agents: [], activities })

const aRun = (cfg: TPiCrustConfig, resume?: ReadonlySet<string>): TRun => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-revise-loop-driver-'))

  return runWithTracer(
    dir,
    crustConfigSchema.parse({
      ...cfg,
      defaults: { data_dir: join(dir, 'runtime') },
      observability: { db: join(dir, 'crust.db') },
    }),
    resume,
  )
}

const contextFor = (
  run: TRun,
  overrides: Readonly<Partial<TActivityContext>> = {},
): TActivityContext => ({
  run,
  prompt: 'x',
  previous: undefined,
  previousStep: undefined,
  upstream: [],
  cohort: [],
  baseline: '',
  outcomes: [],
  feedback: [],
  ...overrides,
})

const reviewEnvelope = (
  overrides: Readonly<Partial<Record<string, unknown>>> = {},
): TEnvelopeBase =>
  ({
    status: 'success',
    summary: '',
    artifacts: [],
    notes_for_next_agent: '',
    facts: [],
    decisions: [],
    assumptions: [],
    unresolved: [],
    risks: [],
    objective_met: { met: true, evidence: 'fixture' },
    regress_to: { activity: '', because: '' },
    approved: false,
    findings: [],
    blocking: [],
    ...overrides,
  }) as unknown as TEnvelopeBase

const buildEnvelope = (
  overrides: Readonly<Partial<Record<string, unknown>>> = {},
): TEnvelopeBase =>
  ({
    status: 'success',
    summary: '',
    artifacts: [],
    notes_for_next_agent: '',
    facts: [],
    decisions: [],
    assumptions: [],
    unresolved: [],
    risks: [],
    objective_met: { met: true, evidence: 'fixture' },
    regress_to: { activity: '', because: '' },
    changed_files: [],
    commit_message: '',
    disputes: [],
    ...overrides,
  }) as unknown as TEnvelopeBase

/** `{sessionDir}/{agentName}/envelope.json` — what replay reads back. */
const planted = (
  run: TRun,
  agentName: string,
  envelope: TEnvelopeBase,
): void => {
  const dir = join(run.sessionDir, agentName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'envelope.json'),
    `${JSON.stringify({ agent_name: agentName, purpose: '', output_type: '', ...envelope })}\n`,
  )
}

test(
  [
    'given use-cases/revise-loop::runReviseLoop',
    'when the chain does not end in a review at all',
    "it should settle 'not-applicable', carrying the chain's own acceptance forward",
  ].join(', '),
  async () => {
    using _terminal = capturedTerminal()
    // given
    const cfg = cfgWith([
      {
        name: 'build',
        output: 'buildOutput',
        prompts: PROMPT_ENGINEERING,
      },
    ])
    const run = aRun(cfg)
    const ctx = contextFor(run, {
      outcomes: [{ activity: 'build', accepted: true }],
    })

    // when
    const actual = await runReviseLoop(run, {
      names: ['build'],
      options: DEFAULT_ACTIVITY_OPTIONS,
      ctx,
      fallbackReason: 'fallback',
    })

    // then
    expect(actual.outcome).toEqual('not-applicable')
    expect(actual.accepted).toBe(true)
    expect(actual.reason).toEqual('fallback')
  },
)

test(
  [
    'given use-cases/revise-loop::runReviseLoop',
    'when a chain ends in a review but no reviser is configured for it',
    "it should settle 'not-applicable' rather than invent a writer to revise with",
  ].join(', '),
  async () => {
    using _terminal = capturedTerminal()
    // given — no Activity named 'build' exists anywhere in this registry
    const cfg = cfgWith([
      {
        name: 'review',
        output: 'reviewOutput',
        prompts: PROMPT_ENGINEERING,
      },
    ])
    const run = aRun(cfg)
    const ctx = contextFor(run, {
      outcomes: [{ activity: 'review', accepted: false }],
    })

    // when
    const actual = await runReviseLoop(run, {
      names: ['review'],
      options: DEFAULT_ACTIVITY_OPTIONS,
      ctx,
      fallbackReason: 'fallback',
    })

    // then
    expect(actual.outcome).toEqual('not-applicable')
  },
)

test(
  [
    'given use-cases/revise-loop::runReviseLoop',
    "when the reviser's attempt budget is already spent before the loop opens",
    "it should settle 'exhausted', unaccepted, and write the dispute report",
  ].join(', '),
  async () => {
    using _terminal = capturedTerminal()
    // given
    const cfg = cfgWith([
      {
        name: 'build',
        output: 'buildOutput',
        prompts: PROMPT_ENGINEERING,
        attempts: 1,
      },
      {
        name: 'review',
        output: 'reviewOutput',
        prompts: PROMPT_ENGINEERING,
      },
    ])
    const run = aRun(cfg)
    const review = reviewEnvelope({
      blocking: ['the handler is unguarded'],
      findings: [
        {
          requirement: 'the handler is unguarded',
          met: false,
          evidence: 'src/server.ts:42',
        },
      ],
    })
    const ctx = contextFor(run, {
      previous: review,
      previousStep: 'review',
      upstream: [{ activity: 'review', envelope: review }],
      outcomes: [
        { activity: 'build', accepted: true },
        { activity: 'review', accepted: false },
      ],
    })
    const ledger = attemptLedger(['revise']) // build's own attempts: 1, already spent

    // when
    const actual = await runReviseLoop(run, {
      names: ['build', 'review'],
      options: DEFAULT_ACTIVITY_OPTIONS,
      ctx,
      fallbackReason: 'fallback',
      ledger,
    })

    // then
    expect(actual.outcome).toEqual('exhausted')
    expect(actual.accepted).toBe(false)
    const reportPath = join(run.contextHandoffDir, REPORT_FILENAME)
    const report = readFileSync(reportPath, 'utf8')
    expect(report).toContain('the handler is unguarded')
  },
)

test(
  [
    'given use-cases/revise-loop::runReviseLoop',
    'when a round of revise-and-re-review approves, replayed from a resumed session',
    "it should settle 'approved' and accept the run, without spawning an agent",
  ].join(', '),
  async () => {
    using _terminal = capturedTerminal()
    // given
    /*
     * 'build' wrote the thing, 'review' rejected it once. Resuming
     * replays BOTH the revise ('build' is the writer `reviserFor` revises
     * with) and the re-asked 'review_2'. This fixture has no participant
     * snapshots, so replay falls back to the legacy per-agent file,
     * `{sessionDir}/{config.name}/envelope.json`. Numbered review instances
     * still share one latest verdict rather than one envelope per attempt.
     */
    const cfg = cfgWith([
      {
        name: 'build',
        output: 'buildOutput',
        purpose: 'Implement the plan',
        prompts: PROMPT_ENGINEERING,
      },
      {
        name: 'review',
        output: 'reviewOutput',
        purpose: 'Confirm the work',
        prompts: PROMPT_ENGINEERING,
      },
    ])
    /*
     * `reAsked` passes `instance: 2` through `runnableActivities(['review'], ...)`,
     * but `runnableActivities` recomputes `instance` itself from the
     * ARRAY IT WAS GIVEN — a singleton array always yields instance 1, so
     * the re-ask in production actually runs as plain 'review', not
     * 'review_2'. The resume set below names what `skipIfDone` actually
     * checks (`activity.params.name`), not what `reAskedInstances` intended.
     */
    const run = aRun(cfg, new Set(['revise', 'review']))
    planted(
      run,
      'build',
      buildEnvelope({ summary: 'revised', changed_files: ['src/fixed.ts'] }),
    )
    planted(
      run,
      'review',
      reviewEnvelope({ approved: true, summary: 'now it is fine' }),
    )
    const rejected = reviewEnvelope({
      blocking: ['the handler is unguarded'],
      findings: [
        {
          requirement: 'the handler is unguarded',
          met: false,
          evidence: 'src/server.ts:42',
        },
      ],
    })
    const ctx = contextFor(run, {
      previous: rejected,
      previousStep: 'review',
      upstream: [{ activity: 'review', envelope: rejected }],
      outcomes: [
        { activity: 'build', accepted: true },
        { activity: 'review', accepted: false },
      ],
    })

    // when
    const actual = await runReviseLoop(run, {
      names: ['build', 'review'],
      options: DEFAULT_ACTIVITY_OPTIONS,
      ctx,
      fallbackReason: 'fallback',
    })

    // then
    expect(actual.outcome).toEqual('approved')
    expect(actual.accepted).toBe(true)
    expect(
      (actual.ctx.previous as Readonly<{ summary: string }>).summary,
    ).toEqual('revised')
    // the round was recorded, with no agent ever spawned to produce it
    expect(run.tracer.eventsNamed(run.runId, 'human_gate_open')).toHaveLength(0)
  },
)
