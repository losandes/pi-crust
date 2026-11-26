import { expect, test } from 'bun:test'
import type { TEnvelopeBase } from '../../../../lib/contracts'
import { intakeRejection, intakeViolations } from './intake'

const context = (fields: Readonly<Record<string, unknown>>): TEnvelopeBase =>
  ({
    status: 'success',
    summary: 'did the thing',
    artifacts: [],
    notes_for_next_agent: '',
    facts: [],
    decisions: [],
    assumptions: [],
    unresolved: [],
    risks: [],
    objective_met: { met: true, evidence: 'bun test exit 0' },
    regress_to: { activity: '', because: '' },
    ...fields,
  }) as unknown as TEnvelopeBase

test(
  [
    'given use-cases/intake::intakeViolations',
    'when the incoming context is complete',
    'it should report nothing, leaving the judgement to the agent',
  ].join(', '),
  () => {
    // given
    const envelope = context({
      facts: [{ fact: 'the suite is green', evidence: 'bun test exit 0' }],
    })

    // when
    const actual = intakeViolations(envelope, 'build')

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/intake::intakeViolations',
    'when a decision carries no rationale',
    'it should refuse, because this stage would have to re-decide it',
  ].join(', '),
  () => {
    // given
    const envelope = context({
      decisions: [{ decision: 'store it in Postgres', rationale: '  ' }],
    })

    // when
    const actual = intakeViolations(envelope, 'design')

    // then
    expect(actual).toHaveLength(1)
    expect(actual[0]).toContain('store it in Postgres')
  },
)

test(
  [
    'given use-cases/intake::intakeViolations',
    'when an assumption names nothing that would disprove it',
    'it should refuse, because it can never trigger a regression',
  ].join(', '),
  () => {
    // given
    const envelope = context({
      assumptions: [{ assumption: 'the feed is daily', invalidated_by: '' }],
    })

    // when
    const actual = intakeViolations(envelope, 'plan')

    // then
    expect(actual).toHaveLength(1)
    expect(actual[0]).toContain('the feed is daily')
  },
)

test(
  [
    'given use-cases/intake::intakeViolations',
    'when a stage claims its objective was met without evidence',
    'it should refuse, because that claim is the one to doubt',
  ].join(', '),
  () => {
    // given
    const envelope = context({ objective_met: { met: true, evidence: '' } })

    // when
    const actual = intakeViolations(envelope, 'identify')

    // then
    expect(actual).toHaveLength(1)
  },
)

test(
  [
    'given use-cases/intake::intakeViolations',
    'when a stage says plainly that it did NOT meet its objective',
    'it should report nothing structural, because honesty is not a defect',
  ].join(', '),
  () => {
    // given
    const envelope = context({ objective_met: { met: false, evidence: '' } })

    // when
    const actual = intakeViolations(envelope, 'identify')

    // then — the agent decides what to do about it; the shape is fine
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/intake::intakeViolations',
    'when the envelope is not a context envelope at all',
    'it should report nothing, because a code activityRun has no beliefs to state',
  ].join(', '),
  () => {
    // given a verify envelope, which code builds
    const envelope = {
      status: 'success',
      summary: 'checks ran',
      passed: true,
      failures: [],
    } as unknown as TEnvelopeBase

    // when
    const actual = intakeViolations(envelope, 'verify')

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/intake::intakeRejection',
    'when there are violations',
    'it should name the receiving activity and send the fix upstream',
  ].join(', '),
  () => {
    // given
    const violations = ["'plan' records a decision with no rationale"]

    // when
    const actual = intakeRejection(violations, 'build')

    // then
    expect(actual).toContain("'build' will not start")
    expect(actual).toContain('Fix the stage that produced it')
  },
)

test(
  [
    'given use-cases/intake::intakeViolations',
    'when a fact carries no evidence',
    'it should report it, by name',
  ].join(', '),
  () => {
    // given
    const envelope = context({
      facts: [{ fact: 'the suite is green', evidence: '  ' }],
    })

    // when
    const actual = intakeViolations(envelope, 'build')

    // then
    expect(actual[0]).toContain('the suite is green')
  },
)

test(
  [
    'given use-cases/intake::intakeViolations',
    'when no envelope was produced to check',
    'it should see nothing wrong, since there is nothing a tool can see',
  ].join(', '),
  () => {
    // given
    const envelope = undefined

    // when
    const actual = intakeViolations(envelope, 'build')

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/intake::intakeViolations',
    'when the summary uses "todo" as subject matter rather than as boilerplate',
    'it should report nothing, because the word is the diagnosis, not the residue of a template',
  ].join(', '),
  () => {
    // given
    const envelope = context({
      summary:
        "bun test's own console reporter reprints every skip/todo test a second time in " +
        "a trailing roll-up section, and buntap's parser (classify-line.ts/parse-run.ts) " +
        'treats that restatement as a new test event with no deduplication, inflating ' +
        "any tally-based reporter's live total (e.g. nyan's scoreboard) by one per " +
        'skipped/todo test while the authoritative run-end summary stays correct.',
    })

    // when
    const actual = intakeViolations(envelope, 'plan')

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/intake::intakeViolations',
    'when the summary quotes a generic type with no internal whitespace',
    'it should report nothing, because Promise<void> is not a placeholder span',
  ].join(', '),
  () => {
    // given
    const envelope = context({
      summary: 'returns a Promise<void> that resolves once the write settles',
    })

    // when
    const actual = intakeViolations(envelope, 'build')

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/intake::intakeViolations',
    'when the summary describes a path template with a spaced bracketed segment',
    'it should report nothing, because a quoted template is subject matter, not an unfilled field',
  ].join(', '),
  () => {
    // given
    const envelope = context({
      summary:
        'New runs are filed under <host>/<owner>/<repo>/<run id> (or local/<name>/<run id>) ' +
        'in the sessions directory by one rule shared with future clones, and success is ' +
        'recognised by 17 criteria covering placement, URL forms, pre-change runs staying ' +
        'put and usable, machine-wide run-id uniqueness, pruning, branching and documentation.',
    })

    // when
    const actual = intakeViolations(envelope, 'gh-issue')

    // then
    expect(actual).toEqual([])
  },
)
