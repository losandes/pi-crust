import { expect, test } from 'bun:test'
import { genericOutput, ghIssueOutput } from './envelope'
import { issueOpenedBy, openedArtifacts, renderOpened } from './opened-artifact'

const issue = 'https://github.com/acme/widgets/issues/42'
const pullRequest = 'https://github.com/acme/widgets/pull/43'

for (const { name, spec, url, status, expected } of [
  {
    name: 'a matching issue',
    spec: ghIssueOutput,
    url: issue,
    status: 'success',
    expected: issue,
  },
  {
    name: 'a failed issue envelope',
    spec: ghIssueOutput,
    url: issue,
    status: 'fail',
    expected: issue,
  },
  {
    name: 'an empty URL',
    spec: ghIssueOutput,
    url: '',
    status: 'success',
    expected: undefined,
  },
  {
    name: 'a placeholder URL',
    spec: ghIssueOutput,
    url: 'https://github.com/<owner>/<name>/issues/<n>',
    status: 'success',
    expected: undefined,
  },
  {
    name: 'text after the number',
    spec: ghIssueOutput,
    url: `${issue} trailing`,
    status: 'success',
    expected: undefined,
  },
  {
    name: 'another output type',
    spec: genericOutput,
    url: issue,
    status: 'success',
    expected: undefined,
  },
] as const) {
  test(
    [
      `given ${name}`,
      'when identifying an opened issue',
      'it should return only the declared issue URL',
    ].join(', '),
    () => {
      // given
      const envelope = {
        status,
        summary: '',
        artifacts: [],
        notes_for_next_agent: '',
        issue_url: url,
      }
      // when
      const actual = issueOpenedBy(spec, envelope)
      // then
      expect(actual).toBe(expected)
    },
  )
}

for (const payload of [
  {},
  { url: 42 },
  { url: 'http://example.com/1' },
  { url: `${issue} text` },
  { url: `${issue}\n` },
]) {
  test(
    [
      `given an invalid recorded URL ${JSON.stringify(payload)}`,
      'when collecting opened artifacts',
      'it should discard it from both kinds',
    ].join(', '),
    () => {
      // given
      const recorded = { issues: [payload], pullRequests: [payload] }
      // when
      const actual = openedArtifacts(recorded)
      // then
      expect(actual).toEqual([])
    },
  )
}

test(
  [
    'given repeated issues and pull requests',
    'when collecting opened artifacts',
    'it should preserve group order and the first occurrence of each URL',
  ].join(', '),
  () => {
    // given
    const secondIssue = `${issue}0`
    const secondPr = `${pullRequest}0`
    // when
    const actual = openedArtifacts({
      issues: [{ url: issue }, { url: secondIssue }, { url: issue }],
      pullRequests: [
        { url: pullRequest },
        { url: issue },
        { url: secondPr },
        { url: pullRequest },
      ],
    })
    // then
    expect(actual).toEqual([
      { kind: 'issue', url: issue },
      { kind: 'issue', url: secondIssue },
      { kind: 'pull request', url: pullRequest },
      { kind: 'pull request', url: secondPr },
    ])
  },
)

test(
  [
    'given no artifacts',
    'when rendering opened artifacts',
    'it should return no lines',
  ].join(', '),
  () => {
    // given
    const opened = [] as const
    // when
    const actual = renderOpened(opened)
    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given both artifact kinds',
    'when rendering opened artifacts',
    'it should return exact unstyled lines in order',
  ].join(', '),
  () => {
    // given
    const opened = [
      { kind: 'issue', url: issue },
      { kind: 'pull request', url: pullRequest },
    ] as const
    // when
    const actual = renderOpened(opened)
    // then
    expect(actual).toEqual([
      `  issue          ${issue}`,
      `  pull request   ${pullRequest}`,
    ])
  },
)

test(
  [
    'given a 200-character URL',
    'when rendering opened artifacts',
    'it should keep all characters on a 217-character line',
  ].join(', '),
  () => {
    // given
    const url = 'https://example.com/'.padEnd(200, 'a')
    // when
    const actual = renderOpened([{ kind: 'issue', url }])
    // then
    expect(actual).toEqual([`  issue          ${url}`])
    expect(actual[0]).toHaveLength(217)
    expect(actual[0]).not.toContain('…')
    expect(actual[0]).not.toContain('\u001b')
  },
)
