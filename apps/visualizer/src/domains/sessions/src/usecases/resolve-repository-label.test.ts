import { expect, test } from 'bun:test'
import {
  lastPathSegment,
  resolveRepositoryLabel,
} from './resolve-repository-label'

for (const [path, expected] of [
  ['/repos/alpha', 'alpha'],
  ['alpha', 'alpha'],
  ['/repos/alpha/', 'alpha'],
  ['', ''],
] as const) {
  test(
    [
      `given path ${path}`,
      'when its label is resolved',
      'it should show the final segment',
    ].join(', '),
    () => {
      // given
      // when
      const actual = lastPathSegment(path)
      // then
      expect(actual).toBe(expected)
    },
  )
}
for (const repository of ['alpha', undefined, '']) {
  test(
    [
      `given repository ${repository}`,
      'when a session label is resolved',
      'it should show the recorded label or unknown',
    ].join(', '),
    () => {
      // given
      // when
      const actual = resolveRepositoryLabel({ repository })
      // then
      expect(actual).toBe(repository || 'unknown')
    },
  )
}
