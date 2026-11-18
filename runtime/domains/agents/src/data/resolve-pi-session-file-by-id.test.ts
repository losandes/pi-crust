import { expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolvePiSessionFileById } from './resolve-pi-session-file-by-id'

const header = (id: string, type = 'session'): string =>
  `${JSON.stringify({ type, id })}\n{"type":"message"}\n`

for (const { name, files, expected } of [
  {
    name: 'one matching header',
    files: { 'a.jsonl': header('s1') },
    expected: 'a.jsonl',
  },
  {
    name: 'only a later name matching',
    files: { 'a.jsonl': header('other'), 'b.jsonl': header('s1') },
    expected: 'b.jsonl',
  },
  {
    name: 'no matching id',
    files: { 'a.jsonl': header('other') },
    expected: undefined,
  },
  {
    name: 'invalid JSON before a match',
    files: { 'a.jsonl': 'not JSON\n', 'b.jsonl': header('s1') },
    expected: 'b.jsonl',
  },
  {
    name: 'the wrong header type',
    files: { 'a.jsonl': header('s1', 'message') },
    expected: undefined,
  },
  {
    name: 'a non-jsonl file',
    files: { 'a.txt': header('s1') },
    expected: undefined,
  },
  {
    name: 'two matching headers in reverse creation order',
    files: { 'b.jsonl': header('s1'), 'a.jsonl': header('s1') },
    expected: 'a.jsonl',
  },
  {
    name: 'an invalid header object',
    files: { 'a.jsonl': '[]\n' },
    expected: undefined,
  },
]) {
  test(
    [
      `given resolvePiSessionFileById and ${name}`,
      'when resolving the recorded id',
      'it should return the first matching session file only',
    ].join(', '),
    () => {
      // given
      const dir = mkdtempSync(join(tmpdir(), 'crust-session-file-'))
      try {
        for (const [name, contents] of Object.entries(files)) {
          writeFileSync(join(dir, name), contents)
        }

        // when
        const actual = resolvePiSessionFileById(dir)('s1')

        // then
        expect(actual).toBe(
          expected === undefined ? undefined : resolve(dir, expected),
        )
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
}

test(
  [
    'given resolvePiSessionFileById and an absent directory',
    'when resolving a session',
    'it should return undefined without creating the directory',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-session-file-'))
    try {
      const missing = join(dir, 'missing')

      // when
      const actual = resolvePiSessionFileById(missing)('s1')

      // then
      expect(actual).toBeUndefined()
      expect(existsSync(missing)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

test(
  [
    'given resolvePiSessionFileById and an unreadable entry before a match',
    'when resolving a session',
    'it should skip the entry and return the matching file',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-session-file-'))
    try {
      mkdirSync(join(dir, 'a.jsonl'))
      writeFileSync(join(dir, 'b.jsonl'), header('s1'))

      // when
      const actual = resolvePiSessionFileById(dir)('s1')

      // then
      expect(actual).toBe(join(dir, 'b.jsonl'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)
