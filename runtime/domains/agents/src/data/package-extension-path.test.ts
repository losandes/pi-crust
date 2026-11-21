import { expect, test } from 'bun:test'
import { isAbsolute, resolve } from 'node:path'
import { packageExtensionPath } from './package-extension-path'

test(
  [
    'given a package extension name',
    'when resolving its path',
    'it should resolve absolutely inside the package extensions directory',
  ].join(', '),
  () => {
    // given
    const name = 'path-policy.ts'

    // when
    const path = packageExtensionPath(name)

    // then
    expect(isAbsolute(path)).toBe(true)
    expect(path).toBe(resolve(import.meta.dir, '../../../../extensions', name))
  },
)
