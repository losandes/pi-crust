#!/usr/bin/env bun

import {
  safeParseSettlement,
  type TSettlement,
} from '../lib/typedefs/src/settlement'
import {
  openPiSession,
  piPath,
  resolvePiSessionFileById,
} from './domains/agents'
import { JOIN_CLI, positionalArgs } from './domains/cli'
import { loadConfig } from './domains/config'
import { joinArgv, resolveJoin } from './domains/handoff'
import {
  readRunState,
  resolveAgentSessionByAgent,
  runHasLiveProcess,
} from './domains/trace'
import { repoRoot, resolveDataPaths } from './domains/workspace'
import { EXIT } from './lib/contracts'
import { configPathFromEnv, dbPathFromEnv, type TEnv } from './lib/system'

export const USAGE = [
  'usage: just crust join <run-id> <activity>',
  'env: CRUST_DB and CRUST_CONFIG override the paths; PI_PATH names the pi binary.',
].join('\n')

export type TJoinDeps = Readonly<{
  env: TEnv
  piBinary: string
  open: (argv: readonly string[]) => Promise<TSettlement<number>>
  write: (text: string) => unknown
}>

export const LIVE_DEPS: TJoinDeps = {
  env: process.env,
  piBinary: piPath(),
  open: openPiSession,
  write: process.stderr.write.bind(process.stderr),
}

export const main =
  (deps: TJoinDeps) =>
  async (argv: readonly string[]): Promise<number> => {
    const parsed = safeParseSettlement(() => positionalArgs(argv, JOIN_CLI))
    if (parsed.status === 'error') {
      deps.write(`${parsed.error.message}\n${USAGE}\n`)
      return EXIT.USAGE
    }
    const [runId, activity] = parsed.data
    if (parsed.data.length !== 2 || !runId || !activity) {
      deps.write(`${USAGE}\n`)
      return EXIT.USAGE
    }
    const config = safeParseSettlement(() =>
      loadConfig(configPathFromEnv(deps.env)),
    )
    if (config.status === 'error') {
      deps.write(`join: ${config.error.message}\n`)
      return EXIT.FAILED
    }
    const paths = resolveDataPaths(config.data, repoRoot(), deps.env)
    const dbPath = dbPathFromEnv(deps.env) ?? paths.db
    const target = resolveJoin({
      dataDir: paths.dataDir,
      runState: (id) => readRunState(dbPath, id),
      hasLiveProcess: (id) => runHasLiveProcess(dbPath, id),
      agentSession: resolveAgentSessionByAgent(dbPath),
      sessionFile: (dir, id) => resolvePiSessionFileById(dir)(id),
    })({ runId, activity })
    if (target.status === 'error') {
      deps.write(`join: ${target.error.message}\n`)
      return EXIT.FAILED
    }
    const opened = await deps.open(
      joinArgv(deps.piBinary, target.data.sessionFile),
    )
    if (opened.status === 'error') {
      deps.write(
        `join: could not start ${deps.piBinary}: ${opened.error.message}\n`,
      )
      return EXIT.FAILED
    }
    return opened.data
  }

if (import.meta.main) {
  process.exit(await main(LIVE_DEPS)(process.argv.slice(2)))
}
