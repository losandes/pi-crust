import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { HANDOFF_DIVIDER_PREFIX, HANDOFF_END_LINE } from '../domains/imports'

test(
  [
    'given the issue-filing prompt',
    'when reading its handoff marker instructions',
    'it should contain the importer literals',
  ].join(', '),
  () => {
    // given
    // when
    const actual = readFileSync(
      'runtime/prompt-engineering/gh-issue/user.md',
      'utf8',
    )
    // then
    expect(actual).toContain(HANDOFF_DIVIDER_PREFIX)
    expect(actual).toContain(HANDOFF_END_LINE)
  },
)
