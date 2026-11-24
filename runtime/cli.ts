#!/usr/bin/env bun
import { resolve } from 'node:path'
import {
  planDispatch,
  RECIPE_DOCS,
  resolveCrustHome,
  resolveEnvFiles,
  runBunScript,
} from './domains/cli'
import { resolveGitToplevel } from './domains/workspace'
import type { TEnv } from './lib/system'

type TCliDeps = Readonly<{
  env: TEnv
  cwd: string
  packageRoot: string
  envFiles: typeof resolveEnvFiles
  crustHome: typeof resolveCrustHome
  toplevel: typeof resolveGitToplevel
  run: typeof runBunScript
  write: (text: string) => unknown
}>

const LIVE_DEPS: TCliDeps = {
  env: process.env,
  cwd: process.cwd(),
  packageRoot: resolve(import.meta.dir, '..'),
  envFiles: resolveEnvFiles,
  crustHome: resolveCrustHome,
  toplevel: resolveGitToplevel,
  run: runBunScript,
  write: process.stderr.write.bind(process.stderr),
}

export const main =
  (deps: TCliDeps) =>
  (argv: readonly string[]): number => {
    const env = { ...deps.envFiles(deps.cwd), ...deps.env }
    const home = deps.crustHome(env.CRUST_HOME, deps.cwd, deps.packageRoot)
    if (home.kind === 'invalid') {
      deps.write(
        `crust: CRUST_HOME names ${home.home}, which holds no pi-crust runtime: ${home.home}/runtime/cli.ts does not exist.\n`,
      )
      return 2
    }
    if (home.kind === 'other')
      return deps.run({ script: home.cli, args: argv, cwd: deps.cwd, env })
    const plan = planDispatch(RECIPE_DOCS)({
      argv,
      env,
      cwd: deps.cwd,
      packageRoot: deps.packageRoot,
      repositoryRoot: deps.toplevel(deps.cwd),
    })
    if (plan.status === 'error') {
      deps.write(`${plan.error.message}\n`)
      return 2
    }
    return deps.run({ ...plan.data, env })
  }

if (import.meta.main) process.exit(main(LIVE_DEPS)(process.argv.slice(2)))
