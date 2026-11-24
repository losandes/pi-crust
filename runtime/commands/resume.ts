#!/usr/bin/env bun

/**
 * Pick a stopped run back up, exactly as it was launched.
 *
 *   crust resume <run-id> [--note "what you changed"] [--detach]
 *
 * `--note` is a standing instruction, not a message to a live agent: it is
 * appended to the run's `steering.md` through the handoff directory the run
 * actually recorded, so every activity from here reads it through the
 * steering block `execute-agent.ts` already splices into every prompt. It is
 * NOT routed through the inbox — `execute-agent.ts` records the inbox's
 * length at attach time, so anything posted before a resume would be treated
 * as already consumed and never delivered.
 *
 * `--detach` runs the resumed process in the background, writing to the
 * session's own `resume.log`, for a caller that cannot wait — the same
 * distinction `resumeRecordedRun`'s `TAttachment` already makes.
 *
 * env: CRUST_DB and CRUST_CONFIG override the paths; the flags still win.
 */

import { Database } from 'bun:sqlite'
import { resolve } from 'node:path'
import { errorMessage, safeParseSettlement } from '../../lib/typedefs'
import { appendSteering } from '../domains/agents'
import { positionalArgs, RESUME_CLI, resumeRecordedRun } from '../domains/cli'
import { loadConfig } from '../domains/config'
import { developerNote, flagValue, handoffDirFor } from '../domains/handoff'
import { readRunState } from '../domains/trace'
import { repoRoot, resolveLookupPaths } from '../domains/workspace'
import { configPathFromEnv, nowIso } from '../lib/system'

const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const USAGE = [
  'usage: crust resume <run-id> [--note "what you changed"] [--detach]',
  '',
  '  --note     a standing instruction every activity from here reads, through',
  "             the run's own steering.md — not a message to a live agent",
  '  --detach   run in the background instead of attaching to this terminal',
  '',
  'env: CRUST_DB and CRUST_CONFIG override the paths; the flags still win.',
].join('\n')

const main = async (): Promise<number> => {
  const argv = process.argv.slice(2)
  const positionals = safeParseSettlement(() =>
    positionalArgs(argv, RESUME_CLI),
  )
  if (positionals.status === 'error') {
    say(errorMessage(positionals.error))
    say(USAGE)
    return 2
  }
  const runId = positionals.data[0]
  if (runId === undefined) {
    say(USAGE)
    return 2
  }
  // `--note` given with nothing after it is a mistake, not a request to
  // resume without one — the same refusal `--handoff ''` already makes.
  if (argv.includes('--note') && flagValue(argv, '--note') === undefined) {
    say(USAGE)
    return 2
  }
  const note = flagValue(argv, '--note') ?? ''
  const detach = argv.includes('--detach')

  const cfg = loadConfig(configPathFromEnv())
  const { db: dbPath, dataDir } = resolveLookupPaths(cfg, repoRoot())

  const state = readRunState(dbPath, runId)
  if (state === undefined) {
    say(`no run ${runId} in ${dbPath}`)
    return 1
  }

  if (note.trim() !== '') {
    const handoffDir = handoffDirFor(dataDir, runId)
    const at = nowIso()
    const path = appendSteering(handoffDir, developerNote(note, at))
    say(`note recorded in ${path}`)

    const db = new Database(dbPath)
    db.run('PRAGMA busy_timeout=5000;')
    db.run(
      'INSERT INTO events (event_id, run_id, type, name, payload_json, started_at)' +
        ' VALUES (?,?,?,?,?,?)',
      [
        `evt_note_${Date.now()}`,
        runId,
        'log',
        'developer_note',
        JSON.stringify({
          note,
          from: process.env.USER ?? 'a developer',
          at,
          recorded: path,
        }),
        at,
      ],
    )
    db.close()
  }

  const resumed = resumeRecordedRun(
    resolve(dataDir, 'sessions', runId),
    detach ? 'detached' : 'attached',
  )
  say(resumed.started ? `resumed: ${resumed.command}` : resumed.reason)
  if (!resumed.started) return 1
  return (await resumed.finished) ?? 0
}

process.exitCode = await main()
