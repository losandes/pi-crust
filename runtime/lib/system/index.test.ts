import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { PACKAGE_ROOT, packageProgram, whichOnPath } from './index'

test(
  [
    'given the system public API',
    'when locating a package program and a missing executable',
    'it should expose package-relative resolution and PATH discovery',
  ].join(', '),
  () => {
    // given
    // when
    const cli = packageProgram('runtime/cli.ts')
    // then
    expect(cli).toBe(join(PACKAGE_ROOT, 'runtime/cli.ts'))
    expect(existsSync(cli)).toBe(true)
    expect(whichOnPath('no-such-crust-program', { PATH: '' })).toBeUndefined()
  },
)
