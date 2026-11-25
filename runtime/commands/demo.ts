#!/usr/bin/env bun
import { runProgram } from '../domains/cli'
import { DEFAULT_CONFIG_PATH } from '../lib/contracts'
import type { TEnv } from '../lib/system'
import { packageProgram } from '../lib/system'

type TDemoDeps = Readonly<{
  env: TEnv
  cwd: string
  run: typeof runProgram
  write: (text: string) => unknown
}>

const LIVE_DEPS: TDemoDeps = {
  env: process.env,
  cwd: process.cwd(),
  run: runProgram,
  write: process.stdout.write.bind(process.stdout),
}

export const main =
  (deps: TDemoDeps) =>
  (argv: readonly string[]): number => {
    const at = argv.indexOf('--config')
    const config =
      (at < 0 ? undefined : argv[at + 1]) ??
      deps.env.CRUST_CONFIG ??
      DEFAULT_CONFIG_PATH
    const run = (prompt: string, activity: string): number =>
      deps.run({
        script: packageProgram('runtime/commands/run.ts'),
        args: ['--config', config, prompt, '--activities', activity],
        cwd: deps.cwd,
        env: deps.env,
      })
    deps.write('1/2  scout: read-only recon\n')
    const first = run(
      'list the top-level directories in this repo and what each is for. change nothing.',
      'scout',
    )
    if (first !== 0) return first
    deps.write('\n2/2  identify: the outcome and how success is recognised\n')
    const second = run(
      'state the outcome a newcomer to this repo would want from it, and how they would know they had it',
      'identify',
    )
    if (second !== 0) return second
    deps.write('\nboth done. now run:  crust sessions    (or: crust observe)\n')
    return 0
  }

if (import.meta.main) process.exit(main(LIVE_DEPS)(process.argv.slice(2)))
