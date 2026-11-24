import { spawnSync } from 'node:child_process'
import type { TEnv } from '../../../../lib/system'

export type TScriptRun = Readonly<{
  script: string
  args: readonly string[]
  cwd: string
}>

export const runBunScript = (
  run: TScriptRun & Readonly<{ env: TEnv }>,
): number =>
  spawnSync('bun', [run.script, ...run.args], {
    cwd: run.cwd,
    env: run.env,
    stdio: 'inherit',
  }).status ?? 1
