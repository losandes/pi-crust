import { expect, test } from 'bun:test'
import { hasQuotedTaskVariable } from './task-command'

for (const [command, expected] of [
  ["'{{changed_paths}}'", true],
  ['"{{changed_paths}}"', true],
  ['echo "x {{base_ref}}"', true],
  ['echo \'a\' "{{base_ref}}"', true],
  ["echo 'a' {{base_ref}}", false],
  ['echo "a" {{changed_paths}}', false],
  ["echo it\\'s {{base_ref}}", false],
  ['echo "{{unknown}}"', false],
] as const) {
  test(
    [
      `given ${command}`,
      'when scanning its task variables',
      'it should identify only supported variables within quotes',
    ].join(', '),
    () => {
      // given
      // when
      const actual = hasQuotedTaskVariable(command)
      // then
      expect(actual).toBe(expected)
    },
  )
}
