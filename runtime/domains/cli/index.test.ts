import { expect, test } from 'bun:test'
import { crustArgv, dispatchArgv, planDispatch, RECIPE_DOCS } from '.'

for (const command of ['run', 'operator']) {
  test(
    [
      `given the public CLI API and a ${command} command`,
      'when a typed command is dispatched',
      'it should select the program and preserve a multiword prompt',
    ].join(', '),
    () => {
      // given
      const argv = crustArgv(command, ['fix the login bug'])
      // when
      const actual = planDispatch(RECIPE_DOCS)({
        argv: dispatchArgv(argv),
        env: {},
        cwd: '/repo',
        repositoryRoot: '/repo',
        packageRoot: '/pkg',
      })
      // then
      expect(argv).toEqual(['crust', command, 'fix the login bug'])
      expect(actual.status).toBe('ok')
      if (actual.status === 'ok') {
        expect(actual.data.script).toBe(`/pkg/runtime/commands/${command}.ts`)
        expect(actual.data.args).toEqual([
          '--config',
          'pi-crust.toml',
          'fix the login bug',
        ])
      }
    },
  )
}
