import { expect, test } from 'bun:test'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { whichOnPath } from './which-on-path'

test(
  [
    'given executable files, directories and non-executable files on PATH',
    'when finding a program',
    'it should select the first regular executable and tolerate missing entries',
  ].join(', '),
  () => {
    // given
    const root = mkdtempSync(join(tmpdir(), 'crust-which-'))
    const dirs = ['directory', 'text', 'first', 'second'].map((name) =>
      join(root, name),
    )
    dirs.forEach((dir) => {
      mkdirSync(dir)
    })
    mkdirSync(join(dirs[0] ?? '', 'pi'))
    dirs.slice(1).forEach((dir) => {
      writeFileSync(join(dir, 'pi'), '#!/bin/sh\n')
    })
    dirs.slice(2).forEach((dir) => {
      chmodSync(join(dir, 'pi'), 0o755)
    })
    try {
      // when
      const actual = whichOnPath('pi', {
        PATH: [join(root, 'missing'), ...dirs].join(delimiter),
      })
      // then
      expect(actual).toBe(join(root, 'first', 'pi'))
      expect(whichOnPath('no-such-crust-program', {})).toBeUndefined()
      expect(whichOnPath('no-such-crust-program')).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)
