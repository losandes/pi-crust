import { expect, test } from 'bun:test'
import {
  buildOutput,
  contextEnvelopeSchema,
  envelopeAccepted,
  envelopeJudges,
  envelopeNamed,
  genericOutputSchema,
  ghIssueOutputSchema,
  narrowEnvelope,
  questionSchema,
  regressionOf,
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

test(
  [
    'given typedefs/envelope::questionSchema',
    'when a stored question still names the pre-rename `irreversible` field',
    'it should migrate it to beyond_this_run rather than fail to parse',
  ].join(', '),
  () => {
    // given — a trace written before the rename
    const legacy = {
      question: 'should this ship',
      consequential: true,
      irreversible: true,
      provisional_answer: 'yes',
    }

    // when
    const actual = questionSchema.parse(legacy)

    // then
    expect(actual.beyond_this_run).toBe(true)
    expect('irreversible' in actual).toBe(false)
  },
)

test(
  [
    'given typedefs/envelope::questionSchema',
    'when a question already carries beyond_this_run',
    'it should parse it unchanged, ignoring any stray irreversible field',
  ].join(', '),
  () => {
    // given
    const current = {
      question: 'should this ship',
      consequential: true,
      beyond_this_run: false,
      provisional_answer: 'yes',
    }

    // when
    const actual = questionSchema.parse(current)

    // then
    expect(actual.beyond_this_run).toBe(false)
  },
)

test(
  [
    'given typedefs/envelope::regressionOf',
    'when the envelope is undefined',
    'it should answer undefined, because there is nothing to have asked',
  ].join(', '),
  () => {
    // given, when
    const actual = regressionOf(undefined)

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given typedefs/envelope::regressionOf',
    'when the envelope does not parse as a context envelope at all',
    'it should answer undefined rather than throw',
  ].join(', '),
  () => {
    // given
    const notAContextEnvelope = {
      status: 'success',
    } as unknown as TEnvelopeBase

    // when
    const actual = regressionOf(notAContextEnvelope)

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given typedefs/envelope::regressionOf',
    'when the envelope asked to regress to a named stage',
    'it should return that request',
  ].join(', '),
  () => {
    // given
    const envelope = {
      status: 'success',
      summary: 'poc disproved the architecture',
      artifacts: [],
      notes_for_next_agent: '',
      facts: [],
      decisions: [],
      assumptions: [],
      unresolved: [],
      risks: [],
      objective_met: { met: true, evidence: 'checked' },
      regress_to: { activity: 'conceptualize', because: 'measured, see facts' },
    } as unknown as TEnvelopeBase

    // when
    const actual = regressionOf(envelope)

    // then
    expect(actual).toEqual({
      activity: 'conceptualize',
      because: 'measured, see facts',
    })
  },
)

test(
  [
    'given typedefs/envelope::envelopeNamed',
    'when an Activity names a spec that is published',
    'it should find it in the catalogue',
  ].join(', '),
  () => {
    // given, when
    const actual = envelopeNamed('buildOutput')

    // then
    expect(actual).toBe(buildOutput)
  },
)

test(
  [
    'given typedefs/envelope::envelopeNamed',
    'when nothing publishes the named spec',
    'it should answer undefined',
  ].join(', '),
  () => {
    // given, when
    const actual = envelopeNamed('no-such-spec')

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given typedefs/envelope::envelopeAccepted',
    'when the spec is a review and it approved',
    'it should accept',
  ].join(', '),
  () => {
    // given
    const approved = { ...review, approved: true } as unknown as TEnvelopeBase

    // when
    const actual = envelopeAccepted(reviewOutput, approved)

    // then
    expect(actual).toBe(true)
  },
)

test(
  [
    'given typedefs/envelope::envelopeAccepted',
    'when the spec is a review and it did not approve',
    'it should reject, regardless of status',
  ].join(', '),
  () => {
    // given, when
    const actual = envelopeAccepted(reviewOutput, review)

    // then
    expect(actual).toBe(false)
  },
)

test(
  [
    'given typedefs/envelope::envelopeAccepted',
    'when the spec is not a review',
    'it should accept exactly when status is success',
  ].join(', '),
  () => {
    // given, when
    const actual = envelopeAccepted(buildOutput, build)

    // then
    expect(actual).toBe(true)
  },
)

test(
  [
    'given typedefs/envelope::narrowEnvelope',
    'when the envelope is undefined',
    'it should answer undefined rather than call the schema at all',
  ].join(', '),
  () => {
    // given, when
    const actual = narrowEnvelope(reviewOutput, undefined)

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given typedefs/envelope::envelopeJudges',
    'when the spec is the review contract',
    'it should say it rules on somebody else\u2019s change',
  ].join(', '),
  () => {
    // given, when
    const actual = envelopeJudges(reviewOutput)

    // then
    expect(actual).toBe(true)
  },
)

test(
  [
    'given typedefs/envelope::envelopeJudges',
    'when the spec is not the review contract',
    'it should say it does not',
  ].join(', '),
  () => {
    // given, when
    const actual = envelopeJudges(buildOutput)

    // then
    expect(actual).toBe(false)
  },
)
