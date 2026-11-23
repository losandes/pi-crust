import { expect, test } from 'bun:test'
import { resolveBranchLabel } from './resolve-branch-label'

for (const [branch, workspace_root, expected] of [
  ['main', '/repo/tree', 'main'],
  ['', '/repo/tree', 'tree'],
  ['', '', 'unknown'],
] as const) {
  test(
    [
      `given branch ${branch}`,
      'when a session branch label is resolved',
      'it should prefer the recorded branch then working tree then unknown',
    ].join(', '),
    () => {
      // given
      // when
      const actual = resolveBranchLabel({ branch, workspace_root })
      // then
      expect(actual).toBe(expected)
    },
  )
}
