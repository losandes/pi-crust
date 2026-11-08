import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolvePrompt } from './resolve-prompt'

test(
  [
    'given use-cases/resolve-prompt::resolvePrompt',
    'when the arg names a file that exists on disk',
    'it should return the contents of that file',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-resolve-prompt-'))
    const path = join(dir, 'prompt.md')
    writeFileSync(path, 'document what you built\n')

    try {
      // when
      const actual = resolvePrompt(path)

      // then
      expect(actual).toBe('document what you built\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

test(
  [
    'given use-cases/resolve-prompt::resolvePrompt',
    'when the arg names no file on disk',
    'it should return the arg itself, as inline prompt text',
  ].join(', '),
  () => {
    // given
    const inline = 'add retry logic to the fetch call'

    // when
    const actual = resolvePrompt(inline)

    // then
    expect(actual).toBe(inline)
  },
)
