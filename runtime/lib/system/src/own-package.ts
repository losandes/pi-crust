import { existsSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'

export const findPackageRoot = (
  from: string,
  exists: (path: string) => boolean = existsSync,
): string | undefined => {
  if (exists(join(from, 'runtime/config/crust.config.toml'))) return from
  const parent = dirname(from)
  return parent === from ? undefined : findPackageRoot(parent, exists)
}

const requirePackageRoot = (from: string): string => {
  const root = findPackageRoot(from)
  if (root === undefined) throw new Error(`No pi-crust package above ${from}`)
  return root
}

export const PACKAGE_ROOT = requirePackageRoot(import.meta.dirname)
export const PROGRAM_EXTENSION = extname(import.meta.filename)
export const ownProgram = (path: string): string =>
  path.replace(/\.ts$/, PROGRAM_EXTENSION)
export const packageProgram = (sourcePath: string): string =>
  resolve(PACKAGE_ROOT, ownProgram(sourcePath))
export const programName = (path: string): string =>
  basename(path).replace(/\.(?:ts|js)$/, '')
export const RUNTIME_PATH = process.execPath
export const RUNTIME_NAME = basename(process.execPath)
