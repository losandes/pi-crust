import { expect, test } from 'bun:test'
import { basename, join } from 'node:path'
import {
  findPackageRoot,
  ownProgram,
  PACKAGE_ROOT,
  PROGRAM_EXTENSION,
  packageProgram,
  programName,
  RUNTIME_NAME,
  RUNTIME_PATH,
} from './own-package'

test(
  [
    'given nested package directories',
    'when locating a package',
    'it should choose the nearest marker and terminate at the filesystem root',
  ].join(', '),
  () => {
    // given
    const marker = '/pkg/runtime/config/crust.config.toml'
    // when, then
    expect(findPackageRoot('/pkg/runtime/lib', (path) => path === marker)).toBe(
      '/pkg',
    )
    expect(findPackageRoot('/pkg', (path) => path === marker)).toBe('/pkg')
    expect(findPackageRoot('/missing', () => false)).toBeUndefined()
    expect(findPackageRoot(import.meta.dirname)).toBe(PACKAGE_ROOT)
  },
)

test(
  [
    'given source and built program names',
    'when naming the current package programs',
    'it should preserve non-source paths and use the current executable',
  ].join(', '),
  () => {
    // given
    // when
    // then
    expect(PROGRAM_EXTENSION).toBe('.ts')
    expect(ownProgram('/a/run.ts')).toBe('/a/run.ts')
    expect(ownProgram('/a/run.js')).toBe('/a/run.js')
    expect(packageProgram('runtime/cli.ts')).toBe(
      join(PACKAGE_ROOT, 'runtime/cli.ts'),
    )
    expect(programName('/a/run.ts')).toBe('run')
    expect(programName('/a/run.js')).toBe('run')
    expect(programName('/a/other')).toBe('other')
    expect(RUNTIME_PATH).toBe(process.execPath)
    expect(RUNTIME_NAME).toBe(basename(process.execPath))
  },
)
