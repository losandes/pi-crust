import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from './version'

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'crust-version-'))
  return {
    root,
    [Symbol.dispose]: () => rmSync(root, { recursive: true, force: true }),
  }
}

test(
  [
    'given a package manifest with a version',
    'when the version command runs',
    'it should print only the version and exit zero',
  ].join(', '),
  () => {
    // given
    using f = fixture()
    const version = '9.8.7-test.1'
    writeFileSync(join(f.root, 'package.json'), JSON.stringify({ version }))
    let out: string[] = []
    let err: string[] = []
    // when
    const status = main({
      packageRoot: f.root,
      out: (text) => (out = [...out, text]),
      err: (text) => (err = [...err, text]),
    })()
    // then
    expect(status).toBe(0)
    expect(out).toEqual([`${version}\n`])
    expect(err).toEqual([])
  },
)

test(
  [
    'given a package root without a manifest',
    'when the version command runs',
    'it should report the missing manifest and exit one',
  ].join(', '),
  () => {
    // given
    using f = fixture()
    let out: string[] = []
    let err: string[] = []
    // when
    const status = main({
      packageRoot: f.root,
      out: (text) => (out = [...out, text]),
      err: (text) => (err = [...err, text]),
    })()
    // then
    expect(status).toBe(1)
    expect(out).toEqual([])
    expect(err).toHaveLength(1)
    expect(err[0]).toStartWith('crust --version: ')
    expect(err[0]).toContain(join(f.root, 'package.json'))
    expect(err[0]?.endsWith('\n')).toBe(true)
  },
)
