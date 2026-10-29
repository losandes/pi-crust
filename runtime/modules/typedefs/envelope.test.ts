import { expect, test } from 'bun:test'
import {
  buildOutput,
  contextEnvelopeSchema,
  genericOutputSchema,
  ghIssueOutputSchema,
  narrowEnvelope,
  reviewOutput,
  type TEnvelopeBase,
} from './envelope'

const review = {
  status: 'success',
  summary: 'two of three met',
  artifacts: [],
  notes_for_next_agent: '',
  facts: [],
  decisions: [],
  assumptions: [],
  unresolved: [],
  risks: [],
  objective_met: { met: true, evidence: 'checked' },
  regress_to: { activity: '', because: '' },
  approved: false,
  findings: [{ requirement: 'a thing', met: false, evidence: 'src/x.ts:1' }],
  blocking: ['a thing'],
} as unknown as TEnvelopeBase

const build = {
  status: 'success',
  summary: 'built it',
  artifacts: [],
  notes_for_next_agent: '',
  facts: [],
  decisions: [],
  assumptions: [],
  unresolved: [],
  risks: [],
  objective_met: { met: true, evidence: 'checked' },
  regress_to: { activity: '', because: '' },
  changed_files: ['src/x.ts'],
  commit_message: 'do the thing',
  disputes: [],
} as unknown as TEnvelopeBase

test(
  [
    'given typedefs/envelope::narrowEnvelope',
    'when the envelope is the kind the spec describes',
    'it should return it with that type',
  ].join(', '),
  () => {
    // given
    const envelope = review

    // when
    const actual = narrowEnvelope(reviewOutput, envelope)

    // then
    expect(actual?.blocking).toEqual(['a thing'])
  },
)

test(
  [
    'given typedefs/envelope::narrowEnvelope',
    'when handed an envelope of a different kind',
    'it should return undefined, because a claim field cannot be defaulted in',
  ].join(', '),
  () => {
    // given a BUILD envelope, narrowed as though it were a review
    const envelope = build

    // when
    const actual = narrowEnvelope(reviewOutput, envelope)

    // then — `approved`, `findings` and `blocking` are required, so there is
    // no shape here to mistake for a verdict. While they defaulted, this
    // returned `approved: false` and a loop would have revised against a
    // rejection nobody wrote.
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given typedefs/envelope::narrowEnvelope',
    'when two activities share an envelope shape',
    'it should not be asked to tell them apart',
  ].join(', '),
  () => {
    // given the same shape `review` and `code-review` both produce
    const envelope = review

    // when
    const actual = narrowEnvelope(reviewOutput, envelope)

    // then — it parses for either, which is why TActivityContext.previousStep
    // records WHICH activity produced it. Required fields fix the cross-kind
    // confusion; they cannot fix the same-kind one.
    expect(actual?.approved).toBe(false)
  },
)

test(
  [
    'given typedefs/envelope::narrowEnvelope',
    'when there is no previous envelope at all',
    'it should return undefined',
  ].join(', '),
  () => {
    // given
    const envelope = undefined

    // when
    const actual = narrowEnvelope(buildOutput, envelope)

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given typedefs/envelope::contextEnvelopeSchema',
    'when an agent omits its assumptions',
    'it should fail to parse rather than report having none',
  ].join(', '),
  () => {
    // given an envelope with every field but one
    const envelope = {
      status: 'success',
      summary: 'did the thing',
      artifacts: [],
      notes_for_next_agent: '',
      facts: [],
      decisions: [],
      unresolved: [],
      risks: [],
      objective_met: { met: true, evidence: 'tests pass' },
      regress_to: { activity: '', because: '' },
    }

    // when
    const actual = contextEnvelopeSchema.safeParse(envelope)

    // then — "no assumptions" is the most consequential claim a stage makes,
    // and a default would have let an omission make it silently. The agent is
    // re-prompted with the error instead.
    expect(actual.success).toBe(false)
  },
)

test(
  [
    'given typedefs/envelope::contextEnvelopeSchema',
    'when an agent states that it assumed nothing',
    'it should parse, because an empty list is an answer',
  ].join(', '),
  () => {
    // given
    const envelope = {
      status: 'success',
      summary: 'did the thing',
      artifacts: [],
      notes_for_next_agent: '',
      facts: [{ fact: 'the suite is green', evidence: 'bun test exit 0' }],
      decisions: [],
      assumptions: [],
      unresolved: [],
      risks: [],
      objective_met: { met: true, evidence: 'bun test exit 0' },
      regress_to: { activity: '', because: '' },
    }

    // when
    const actual = contextEnvelopeSchema.safeParse(envelope)

    // then
    expect(actual.success).toBe(true)
  },
)

test(
  [
    'given typedefs/envelope::genericOutputSchema',
    'when a one-shot prompt answers without any lifecycle context',
    'it should parse, because `prompt` is not a stage',
  ].join(', '),
  () => {
    // given
    const envelope = { status: 'success', summary: 'the answer is 42' }

    // when
    const actual = genericOutputSchema.safeParse(envelope)

    // then
    expect(actual.success).toBe(true)
  },
)

const ghIssueFields = {
  status: 'success',
  summary: 'opened an issue',
  artifacts: ['.pi-crust/data/sessions/abc/context_handoff/gh_issue.md'],
  notes_for_next_agent: '',
  facts: [],
  decisions: [],
  assumptions: [],
  unresolved: [],
  risks: [],
  objective_met: { met: true, evidence: 'gh issue create exited 0' },
  regress_to: { activity: '', because: '' },
  issue_url: 'https://github.com/losandes/pi-crust/issues/42',
  issue_number: 42,
  repo: 'losandes/pi-crust',
}

test(
  [
    'given typedefs/envelope::ghIssueOutputSchema',
    'when every field, including issue_url, issue_number and repo, is present',
    'it should parse',
  ].join(', '),
  () => {
    // given
    const envelope = { ...ghIssueFields }

    // when
    const actual = ghIssueOutputSchema.safeParse(envelope)

    // then
    expect(actual.success).toBe(true)
  },
)

test(
  [
    'given typedefs/envelope::ghIssueOutputSchema',
    'when issue_url is omitted',
    'it should fail to parse rather than default to an empty reference',
  ].join(', '),
  () => {
    // given
    const { issue_url: _issue_url, ...envelope } = ghIssueFields

    // when
    const actual = ghIssueOutputSchema.safeParse(envelope)

    // then
    expect(actual.success).toBe(false)
  },
)

test(
  [
    'given typedefs/envelope::ghIssueOutputSchema',
    'when issue_number is omitted',
    'it should fail to parse',
  ].join(', '),
  () => {
    // given
    const { issue_number: _issue_number, ...envelope } = ghIssueFields

    // when
    const actual = ghIssueOutputSchema.safeParse(envelope)

    // then
    expect(actual.success).toBe(false)
  },
)

test(
  [
    'given typedefs/envelope::ghIssueOutputSchema',
    'when repo is omitted',
    'it should fail to parse',
  ].join(', '),
  () => {
    // given
    const { repo: _repo, ...envelope } = ghIssueFields

    // when
    const actual = ghIssueOutputSchema.safeParse(envelope)

    // then
    expect(actual.success).toBe(false)
  },
)
