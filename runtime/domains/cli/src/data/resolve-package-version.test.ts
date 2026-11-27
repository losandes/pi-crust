import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolvePackageVersion } from './resolve-package-version'

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'crust-package-version-'))
  return {
    root,
    [Symbol.dispose]: () => rmSync(root, { recursive: true, force: true }),
  }
}

for (const version of ['1.2.3', '9.8.7-test.1']) {
  test(
    [
      `given a manifest with version ${version}`,
      'when resolving the package version',
      'it should return the version unchanged',
    ].join(', '),
    () => {
      // given
      using f = fixture()
      writeFileSync(
        join(f.root, 'package.json'),
        JSON.stringify({ name: 'test-package', version }),
      )
      // when
      const result = resolvePackageVersion(f.root)
      // then
      expect(result).toEqual({ status: 'ok', data: version })
    },
  )
}

for (const { name, manifest } of [
  { name: 'a missing manifest', manifest: undefined },
  { name: 'invalid JSON', manifest: 'not JSON' },
  { name: 'a missing version', manifest: '{}' },
  { name: 'a numeric version', manifest: '{"version":123}' },
  { name: 'an empty version', manifest: '{"version":""}' },
]) {
  test(
    [
      `given ${name}`,
      'when resolving the package version',
      'it should settle with an error',
    ].join(', '),
    () => {
      // given
      using f = fixture()
      if (manifest !== undefined)
        writeFileSync(join(f.root, 'package.json'), manifest)
      // when
      const result = resolvePackageVersion(f.root)
      // then
      expect(result.status).toBe('error')
    },
  )
}
