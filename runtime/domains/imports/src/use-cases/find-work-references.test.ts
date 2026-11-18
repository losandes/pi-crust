import { expect, test } from 'bun:test'
import { findWorkReferences } from './find-work-references'

for (const { text, path, expected } of [
  {
    text: '#5',
    expected: [
      { kind: 'github-issue', written: '#5', repository: '', number: 5 },
    ],
  },
  {
    text: 'owner/name#5',
    expected: [
      {
        kind: 'github-issue',
        written: 'owner/name#5',
        repository: 'owner/name',
        number: 5,
      },
    ],
  },
  {
    text: 'https://github.com/owner/name/issues/5#issuecomment-1',
    expected: [
      {
        kind: 'github-issue',
        written: 'https://github.com/owner/name/issues/5#issuecomment-1',
        repository: 'owner/name',
        number: 5,
      },
    ],
  },
  {
    text: 'use (`guide.md`).',
    expected: [{ kind: 'document', written: 'guide.md', path: 'guide.md' }],
  },
  { text: 'https://example.com/a.md', expected: [] },
  {
    text: '#9',
    path: 'plan.MARKDOWN',
    expected: [
      { kind: 'document', written: 'plan.MARKDOWN', path: 'plan.MARKDOWN' },
    ],
  },
  {
    text: '#9',
    path: 'notes.txt',
    expected: [
      { kind: 'github-issue', written: '#9', repository: '', number: 9 },
    ],
  },
] as const) {
  test(
    [
      'given a reference token',
      `when scanning ${text} with ${path ?? 'no path'}`,
      'it should recognise exactly its source',
    ].join(', '),
    () => {
      // given
      // when
      const actual = findWorkReferences(text, path)
      // then
      expect(actual).toEqual(expected)
    },
  )
}
test(
  [
    'given mixed references',
    'when scanning in pattern order',
    'it should return appearance order',
  ].join(', '),
  () => {
    // given
    const text = 'a.md #3 owner/name#2 https://github.com/o/n/issues/1'
    // when
    const actual = findWorkReferences(text, undefined)
    // then
    expect(actual.map((reference) => reference.written)).toEqual(
      text.split(' '),
    )
  },
)
