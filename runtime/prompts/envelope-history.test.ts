import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

for (const activity of ['build', 'plan']) {
  test(
    [
      `given prompts/${activity}/user.md`,
      'when its input variables are read',
      'it should render the whole envelope history as well as the single previous envelope',
    ].join(', '),
    () => {
      // given
      const path = join(import.meta.dir, activity, 'user.md')

      // when
      const actual = readFileSync(path, 'utf8')

      // then
      expect(
        actual.includes('### previous_envelopes\n\n{{previous_envelopes}}'),
      ).toBe(true)
      expect(
        actual.includes('### previous_envelope\n\n{{previous_envelope}}'),
      ).toBe(true)
    },
  )
}

test(
  [
    'given the builder revision instructions',
    'when multiple reviewers have returned verdicts',
    'it should require every verdict and its own evidence to be examined',
  ].join(', '),
  () => {
    // given
    const path = join(import.meta.dir, 'build', 'user.md')

    // when
    const actual = readFileSync(path, 'utf8')

    // then
    expect(actual.includes('Answer every blocking item in all of them')).toBe(
      true,
    )
    expect(actual.includes("Read the finding's own evidence")).toBe(true)
  },
)
