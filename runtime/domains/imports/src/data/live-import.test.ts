import { expect, spyOn, test } from 'bun:test'
import * as childProcess from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { liveImport } from './live-import'

const response = (stdout: string, status = 0, stderr = '') =>
  ({
    stdout,
    stderr,
    status,
    signal: undefined,
    pid: 1,
    output: [],
  }) as unknown as ReturnType<typeof childProcess.spawnSync>
const issue = {
  html_url: 'issue',
  created_at: 'created',
  updated_at: 'updated',
  body: undefined,
}
const comment = {
  html_url: 'comment',
  created_at: 'created',
  updated_at: 'edited',
  body: 'answer',
  author_association: 'MEMBER',
  user: { login: 'alice' },
}

for (const { name, outputs, call, expected } of [
  {
    name: 'repository',
    outputs: [response('owner/name\n')],
    call: () => liveImport.repository('/repo'),
    expected: [
      'repo',
      'view',
      '--json',
      'nameWithOwner',
      '-q',
      '.nameWithOwner',
    ],
  },
  {
    name: 'issue with comments',
    outputs: [
      response(JSON.stringify({ ...issue, body: JSON.parse('null') })),
      response(
        `${JSON.stringify(comment)}\n${JSON.stringify({ ...comment, html_url: 'second', body: JSON.parse('null') })}\n`,
      ),
    ],
    call: () => liveImport.issue('owner/name', 150, '/repo'),
    expected: ['api', 'repos/owner/name/issues/150'],
  },
  {
    name: 'pull request',
    outputs: [
      response(JSON.stringify({ ...issue, body: '', pull_request: {} })),
    ],
    call: () => liveImport.issue('owner/name', 150, '/repo'),
    expected: ['api', 'repos/owner/name/issues/150'],
  },
]) {
  test(
    [
      `given gh output for ${name}`,
      'when the live adapter reads it',
      'it should use exact argv and normalise boundary data',
    ].join(', '),
    () => {
      // given
      const spy = spyOn(childProcess, 'spawnSync')
      outputs.forEach((output) => {
        spy.mockReturnValueOnce(output)
      })
      try {
        // when
        const actual = call()
        // then
        expect(spy.mock.calls[0]).toEqual([
          'gh',
          expected,
          { encoding: 'utf8', cwd: '/repo' },
        ])
        expect(actual.status).toBe('ok')
        if (name === 'repository')
          expect(actual).toEqual({ status: 'ok', data: 'owner/name' })
        if (name === 'issue with comments') {
          expect(spy.mock.calls[1]).toEqual([
            'gh',
            [
              'api',
              '--paginate',
              'repos/owner/name/issues/150/comments?per_page=100',
              '--jq',
              '.[]',
            ],
            { encoding: 'utf8', cwd: '/repo' },
          ])
          expect(actual).toMatchObject({
            data: {
              body: '',
              pull_request: false,
              comments: [
                {
                  address: 'comment',
                  author: 'alice',
                  association: 'MEMBER',
                  posted_at: 'created',
                  edited_at: 'edited',
                  body: 'answer',
                },
                { address: 'second', body: '' },
              ],
            },
          })
        }
        if (name === 'pull request') {
          expect(spy).toHaveBeenCalledTimes(1)
          expect(actual).toMatchObject({
            data: { pull_request: true, comments: [] },
          })
        }
      } finally {
        spy.mockRestore()
      }
    },
  )
}

for (const { name, outputs, repository } of [
  {
    name: 'non-zero exit',
    outputs: [response('', 1, ' denied ')],
    repository: true,
  },
  {
    name: 'bad issue JSON',
    outputs: [response('not json')],
    repository: false,
  },
  { name: 'bad issue shape', outputs: [response('{}')], repository: false },
  {
    name: 'comments failure',
    outputs: [
      response(JSON.stringify({ ...issue, body: '' })),
      response('', 1, 'denied'),
    ],
    repository: false,
  },
  {
    name: 'bad comment JSON',
    outputs: [
      response(JSON.stringify({ ...issue, body: '' })),
      response('invalid\n{}'),
    ],
    repository: false,
  },
  {
    name: 'bad comment shape',
    outputs: [response(JSON.stringify({ ...issue, body: '' })), response('{}')],
    repository: false,
  },
  {
    name: 'unreadable issue',
    outputs: [response('', 1, 'denied')],
    repository: false,
  },
]) {
  test(
    [
      `given ${name}`,
      'when reading gh',
      'it should return a failed settlement',
    ].join(', '),
    () => {
      // given
      const spy = spyOn(childProcess, 'spawnSync')
      outputs.forEach((output) => {
        spy.mockReturnValueOnce(output)
      })
      try {
        // when
        const actual = repository
          ? liveImport.repository('/repo')
          : liveImport.issue('owner/name', 150, '/repo')
        // then
        expect(actual.status).toBe('error')
        if (actual.status === 'error' && name === 'non-zero exit')
          expect(actual.error.message).toBe(
            'gh repo view --json nameWithOwner -q .nameWithOwner exited 1: denied',
          )
      } finally {
        spy.mockRestore()
      }
    },
  )
}

test(
  [
    'given a spawn error',
    'when gh is unavailable',
    'it should return a failed settlement',
  ].join(', '),
  () => {
    // given
    const spy = spyOn(childProcess, 'spawnSync').mockImplementation(() => {
      throw new Error('unavailable')
    })
    try {
      // when
      const actual = liveImport.repository('/repo')
      // then
      expect(actual.status).toBe('error')
    } finally {
      spy.mockRestore()
    }
  },
)

test(
  [
    'given a directory containing a file',
    'when writing over or removing the directory through the live ports',
    'it should settle both filesystem failures without changing the file',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-live-import-failure-'))
    const path = join(dir, 'source.md')
    writeFileSync(path, 'original')
    try {
      // when
      const written = liveImport.write(dir, 'replacement')
      const removed = liveImport.remove(dir)
      // then
      expect(written.status).toBe('error')
      expect(removed.status).toBe('error')
      if (written.status === 'error')
        expect(written.error).toBeInstanceOf(Error)
      if (removed.status === 'error')
        expect(removed.error).toBeInstanceOf(Error)
      expect(readFileSync(path, 'utf8')).toBe('original')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

test(
  [
    'given a real UTF-8 file',
    'when reading writing and removing through the live ports',
    'it should preserve bytes digest and filesystem semantics',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-live-import-'))
    const path = join(dir, 'source.md')
    const text = 'héllo\r\n'
    writeFileSync(path, text)
    try {
      // when
      const actual = liveImport.document(path)
      const written = liveImport.write(join(dir, 'nested', 'copy.md'), text)
      const removed = liveImport.remove(path)
      const absent = liveImport.remove(path)
      // then
      expect(written).toEqual({ status: 'ok', data: undefined })
      expect(removed).toEqual({ status: 'ok', data: undefined })
      expect(absent).toEqual({ status: 'ok', data: undefined })
      expect(actual).toEqual({
        status: 'ok',
        data: {
          text,
          sha256: createHash('sha256').update(text).digest('hex'),
          head: '',
          differs_from_head: false,
        },
      })
      expect(existsSync(path)).toBe(false)
      expect(readFileSync(join(dir, 'nested', 'copy.md'), 'utf8')).toBe(text)
      expect(liveImport.exists(join(dir, 'nested', 'copy.md'))).toBe(true)
      expect(liveImport.now()).toMatch(/^\d{4}-/)
      expect(liveImport.document(path)).toMatchObject({
        status: 'error',
        error: { message: 'does not exist' },
      })
      expect(liveImport.document(dir)).toMatchObject({
        status: 'error',
        error: { message: 'is not a file' },
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)
