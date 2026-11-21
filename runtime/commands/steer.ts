#!/usr/bin/env bun
import { resolve } from 'node:path'
import { errorMessage, safeParseSettlement } from '../../lib/typedefs'
import { positionalArgs, resumeRecordedRun, STEER_CLI } from '../domains/cli'
import { loadConfig } from '../domains/config'
import { flagValue, seedingOf, steerTargetOf } from '../domains/handoff'
import { steerBranch, steerOverwrite } from '../domains/runs'

/**
 * Send a run back to a activity with new instructions.
 *
 *   just crust steer <run-id> <activity> --overwrite "what to change"
 *   just crust steer <run-id> <activity> --branch    "what to change" \
 *       [--seeding fork|fresh] [--branch-id <id>]
 *
 * The target and every activity after it run again, in the order the run
 * actually took, each reading the instruction. That is the point: a change
 * at the start of a chain is a change to all of it. To revise ONE activity
 * without disturbing what follows, use `amend` — that is a judgement you are
 * making about the change, and it should be made deliberately.
 *
 * `--overwrite` and `--branch` are both required to be typed, and neither is
 * the default. Overwrite discards the path you are steering away from;
 * branch keeps both as two runs — the source untouched, the branch a new run
 * seeded from it up to the branch point.
 *
 * `--seeding` only matters for `--branch`. `fork` (the default) copies each
 * agent's own conversation, so a replayed activity sees the attempt that was
 * rejected and the instruction that rejected it. `fresh` starts the agents
 * over against the handoff documents alone, which costs less and is the
 * right choice when the old conversation is the problem rather than the
 * context.
 *
 * `--branch-id` names the branch's run id instead of minting one. The server
 * uses this to report the branch's id before its detached child has written
 * a row; a terminal caller rarely needs it.
 *
 * env: CRUST_DB and CRUST_CONFIG override the paths; the flags still win.
 */

import { repoRoot, resolveDataPaths } from '../domains/workspace'
import { DEFAULT_DB } from '../lib/contracts'
import { configPathFromEnv, dbPathFromEnv, newId, nowIso } from '../lib/system'

const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const USAGE = [
  'usage: just crust steer <run-id> <activity> <--overwrite|--branch> "instruction"',
  '         [--seeding fork|fresh]   branch only; fork is the default',
  '         [--branch-id <id>]       branch only; minted when absent, printed either way',
  '',
  '  --overwrite  the steered activities rewrite their own documents; the path',
  '               you are steering away from is not kept',
  '  --branch     a new run, seeded from this one up to the branch point;',
  '               both outcomes stay readable side by side',
  '',
  'Neither is the default. One of them destroys evidence, so it is typed.',
  'env: CRUST_DB and CRUST_CONFIG override the paths; the flags still win.',
].join('\n')

const main = (): Promise<number> => {
  const argv = process.argv.slice(2)
  const positionals = safeParseSettlement(() => positionalArgs(argv, STEER_CLI))
  if (positionals.status === 'error') {
    say(errorMessage(positionals.error))
    say(USAGE)
    return Promise.resolve(2)
  }
  const [runId, activity] = positionals.data
  const target = steerTargetOf(argv)
  const note = positionals.data.slice(2).join(' ').trim()

  if (
    runId === undefined ||
    activity === undefined ||
    target === undefined ||
    note === ''
  ) {
    say(USAGE)
    return Promise.resolve(2)
  }

  const cfg = loadConfig(configPathFromEnv())
  const resolved = resolveDataPaths(cfg, repoRoot())
  const dbPath = resolve(dbPathFromEnv() ?? resolved.db ?? DEFAULT_DB)
  const dataDir = resolved.dataDir

  if (target === 'overwrite') {
    return steerOverwrite({ say, resume: resumeRecordedRun, now: nowIso })({
      dbPath,
      dataDir,
      runId,
      activity,
      note,
    })
  }

  const branchId = flagValue(argv, '--branch-id') ?? newId(8)
  return steerBranch({ say, resume: resumeRecordedRun, now: nowIso })({
    dbPath,
    dataDir,
    runId,
    activity,
    note,
    seeding: seedingOf(argv),
    branchId,
  })
}

process.exitCode = await main()
