import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contentTypeOf, fileResponse } from './static-file'

for (const [extension, expected] of Object.entries({
  html: 'text/html;charset=utf-8',
  js: 'text/javascript;charset=utf-8',
  css: 'text/css;charset=utf-8',
  json: 'application/json;charset=utf-8',
  map: 'application/json;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  bin: 'application/octet-stream',
})) {
  test(
    [
      'given a static asset',
      `when identifying .${extension}`,
      'it should return its content type',
    ].join(', '),
    () => {
      // given
      const path = `file.${extension}`
      // when
      const actual = contentTypeOf(path)
      // then
      expect(actual).toBe(expected)
    },
  )
}

test(
  [
    'given a binary asset and custom headers',
    'when serving it',
    'it should preserve bytes and allow case-insensitive content-type overrides',
  ].join(', '),
  async () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-static-'))
    const path = join(dir, 'file.png')
    const bytes = new Uint8Array([0, 255, 7])
    writeFileSync(path, bytes)
    try {
      // when
      const plain = fileResponse(path)
      const custom = fileResponse(path, {
        'Content-Type': 'text/custom',
        'cache-control': 'no-store',
      })
      // then
      expect(plain.headers.get('content-type')).toBe('image/png')
      expect(new Uint8Array(await plain.arrayBuffer())).toEqual(bytes)
      expect(custom.headers.get('content-type')).toBe('text/custom')
      expect(custom.headers.get('cache-control')).toBe('no-store')
      expect(() => fileResponse(join(dir, 'missing'))).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)
