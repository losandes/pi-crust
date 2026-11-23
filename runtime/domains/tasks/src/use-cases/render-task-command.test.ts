import { expect, test } from 'bun:test'
import { operatorEnv } from '../../../../lib/system'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { runShellCommand } from '../data/run-shell-command'
import { renderTaskCommand } from './render-task-command'

for (const value of [
  'a b',
  "it's",
  '$(printf unexpected)',
  '`printf unexpected`',
  '; printf unexpected',
  'a"b',
  '*',
  '$HOME',
  'a\\b',
  '-n',
]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given a path and ref with the value ${value}`,
      'when rendering task variables and running the real shell',
      'it should deliver each value as a single verbatim argument',
    ].join(', '),
    async () => {
      // given
      const render = renderTaskCommand([value], value)
      const specs = [
        'set -- {{ changed_paths }}; printf \'%s\\n\' "$#" "$@"',
        "true | printf '%s\\n' {{changed_paths}}",
        "printf '%s\\n' {{base_ref}}",
      ]
      // when
      const actual = await Promise.allSettled(
        specs.map((spec) =>
          runShellCommand(300)({
            command: render(spec),
            cwd: process.cwd(),
            timeoutSeconds: 3,
            env: operatorEnv(),
          }),
        ),
      )
      // then
      expect(
        actual.map((outcome) =>
          outcome.status === 'fulfilled'
            ? [outcome.value.returncode, outcome.value.stdout]
            : outcome,
        ),
      ).toEqual([
        [0, `1\n${value}\n`],
        [0, `${value}\n`],
        [0, `${value}\n`],
      ])
    },
  )
}

test(
  [
    'given an unknown variable and an empty base',
    'when rendering a task command',
    'it should preserve unknown brace text and quote the empty argument',
  ].join(', '),
  () => {
    // given
    const render = renderTaskCommand([], '')
    // when
    const actual = render('true {{ unknown }} {{ base_ref }}')
    // then
    expect(actual).toBe("true {{ unknown }} ''")
  },
)
