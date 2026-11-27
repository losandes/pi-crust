#!/usr/bin/env bun
import { join } from 'node:path'
import { errorMessage } from '../../lib/typedefs'
import { resolvePackageVersion } from '../domains/cli'
import { PACKAGE_ROOT } from '../lib/system'

type TVersionDeps = Readonly<{
  packageRoot: string
  out: (text: string) => unknown
  err: (text: string) => unknown
}>

const LIVE_DEPS: TVersionDeps = {
  packageRoot: PACKAGE_ROOT,
  out: process.stdout.write.bind(process.stdout),
  err: process.stderr.write.bind(process.stderr),
}

export const main = (deps: TVersionDeps) => (): number => {
  const version = resolvePackageVersion(deps.packageRoot)
  if (version.status === 'error') {
    deps.err(
      `crust --version: cannot read a version from ${join(deps.packageRoot, 'package.json')}: ${errorMessage(version.error)}\n`,
    )
    return 1
  }
  deps.out(`${version.data}\n`)
  return 0
}

if (import.meta.main) process.exit(main(LIVE_DEPS)())
