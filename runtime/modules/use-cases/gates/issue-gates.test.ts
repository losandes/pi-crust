import { expect, test } from 'bun:test'
import type { TEnvelopeBase } from '../../typedefs/envelope'
import type { TRun } from '../../typedefs/run'
import { issueCreated } from './issue-gates'

/** This gate reads only the envelope, so the run is never touched. */
const NO_RUN = {} as TRun

const ghIssue = (
  overrides: Readonly<Record<string, unknown>>,
): TEnvelopeBase =>
  ({
    status: 'success',
    summary: 'opened an issue',
    artifacts: [],
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
    ...overrides,
  }) as unknown as TEnvelopeBase

const failed = (envelope: TEnvelopeBase): readonly string[] =>
  issueCreated
    .check(envelope, NO_RUN, [])
    .checks.filter((check) => !check.ok)
    .map((check) => check.item)

test(
  [
    'given use-cases/gates::issueCreated',
    'when the envelope reports a well-formed issue URL, number and repo',
    'it should pass every check',
  ].join(', '),
  () => {
    // given
    const envelope = ghIssue({})

    // when
    const actual = failed(envelope)

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/gates::issueCreated',
    'when the envelope omits issue_url',
    'it should refuse it, naming issue_url',
  ].join(', '),
  () => {
    // given — an issue nobody can open is one nobody created
    const envelope = ghIssue({ issue_url: '' })

    // when
    const actual = failed(envelope)

    // then
    expect(actual).toContain('issue_url')
  },
)

test(
  [
    'given use-cases/gates::issueCreated',
    'when issue_number disagrees with the URL\u2019s trailing number',
    'it should refuse it, naming issue_number',
  ].join(', '),
  () => {
    // given
    const envelope = ghIssue({ issue_number: 7 })

    // when
    const actual = failed(envelope)

    // then
    expect(actual).toContain('issue_number')
    expect(actual).not.toContain('issue_url')
  },
)

test(
  [
    'given use-cases/gates::issueCreated',
    'when repo disagrees with the URL\u2019s owner/name',
    'it should refuse it, naming repo',
  ].join(', '),
  () => {
    // given
    const envelope = ghIssue({ repo: 'someone-else/pi-crust' })

    // when
    const actual = failed(envelope)

    // then
    expect(actual).toContain('repo')
    expect(actual).not.toContain('issue_url')
  },
)

test(
  [
    'given use-cases/gates::issueCreated',
    'when the URL is not a GitHub issue URL',
    'it should refuse all three checks, with nothing to check the others against',
  ].join(', '),
  () => {
    // given — a pull-request URL is the cheap case to use
    const envelope = ghIssue({
      issue_url: 'https://github.com/losandes/pi-crust/pull/42',
    })

    // when
    const actual = failed(envelope)

    // then
    expect(actual).toEqual(['issue_url', 'issue_number', 'repo'])
  },
)
