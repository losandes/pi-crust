import { expect, test } from 'bun:test'
import { resolveBranchLabel } from './resolve-branch-label'

for (const { name, branch, expected } of [
  {
    name: 'a recorded branch',
    branch: 'feature/login',
    expected: 'feature/login',
  },
  {
    name: 'a nonblank branch with surrounding whitespace',
    branch: ' feature/login ',
    expected: ' feature/login ',
  },
  { name: 'a missing contract branch', branch: null, expected: 'pi-crust' },
  { name: 'an empty branch', branch: '', expected: 'pi-crust' },
  { name: 'a whitespace-only branch', branch: '   ', expected: 'pi-crust' },
]) {
  test(
    [
      `given ${name}`,
      'when resolving the branch label',
      `it should return ${JSON.stringify(expected)}`,
    ].join(', '),
    () => {
      // given
      const session = { branch, workspace: 'pi-crust' }

      // when
      const actual = resolveBranchLabel(session)

      // then
      expect(actual).toBe(expected)
    },
  )
}
