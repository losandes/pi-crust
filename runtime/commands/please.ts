#!/usr/bin/env bun
import { safeParseSettlement } from '../../lib/typedefs'
import {
  askMenuChoice,
  askOne,
  askOrder,
  askText,
  askWhichRun,
  NEW_RUN,
  planNewRun,
  planResume,
  shellLine,
} from '../domains/cli'
import { loadConfig } from '../domains/config'
import { resolveWaitingRuns } from '../domains/trace'

/**
 * `just crust please` — the command builder.
 *
 * Every flag this assembles can be typed by hand, and once you know them you
 * will. The problem is the cost of a half-remembered one: a lifecycle, a trust
 * level, a delivery mode and an approval point is four decisions, and getting
 * one wrong is a run you kill five minutes in. A menu makes each decision
 * visible with its options and their consequences beside it.
 *
 * It asks for a run id FIRST, because that question subsumes all the others:
 * naming a run means you are continuing one, and nothing else needs asking.
 *
 * It shows the assembled command before running it. The wizard is a way to
 * build a command, not a replacement for knowing them — seeing the line you
 * just described is how the flags become memorable.
 *
 *     just crust please
 */

import { repoRoot, resolveLookupPaths } from '../domains/workspace'
import { DEFAULT_CONFIG_PATH } from '../lib/contracts'
import { configPathFromEnv, dbPathFromEnv } from '../lib/system'
import { box, copyToClipboard, paint, writeLine } from '../lib/terminal'

const DEFAULT_DB = '.pi-crust/data/crust.db'

const EXIT = { SUCCESS: 0, CANCELLED: 130 } as const

export const main = async (): Promise<number> => {
  const cfg = safeParseSettlement(() =>
    loadConfig(configPathFromEnv() ?? DEFAULT_CONFIG_PATH),
  )
  const dbPath =
    cfg.status === 'ok'
      ? resolveLookupPaths(cfg.data, repoRoot()).db
      : (dbPathFromEnv() ?? DEFAULT_DB)

  const ports = { askOne, askText, askOrder, askMenuChoice }
  const which = await askWhichRun(ports)(resolveWaitingRuns(dbPath))
  if (which === undefined) {
    writeLine(paint('nothing started.', 'dim'))
    return EXIT.CANCELLED
  }

  const argv =
    which === NEW_RUN
      ? await planNewRun(ports)(configPathFromEnv() ?? DEFAULT_CONFIG_PATH)
      : await planResume(ports)(which)
  if (argv === undefined) {
    writeLine(paint('nothing started.', 'dim'))
    return EXIT.CANCELLED
  }

  /*
   * Shown before it runs, always. The wizard is a way to BUILD a command, not
   * a replacement for knowing them: seeing the line you just described is how
   * the flags stop needing the wizard.
   */
  /*
   * The recipe, which is the only form there is now: nothing composes a path
   * into the stamp any more, because the runtime does not live there.
   */
  const line = shellLine(argv)
  writeLine(box('the command', [line], 'cyan'))

  /*
   * And it is offered rather than run.
   *
   * Half of what `please` is for is finding out what the flags were; that
   * half is finished by the time the line is on screen. Running it anyway
   * would make the builder unusable as a builder — and a run is expensive
   * enough that starting one nobody confirmed is the wrong default.
   */
  const go = await askOne('go?', [
    {
      value: 'run',
      label: 'run it',
      detail: 'starts now, attached to this terminal',
    },
    {
      value: 'print',
      label: 'just give me the line',
      detail: 'copy it, change it, run it yourself',
    },
  ])
  if (go !== 'run') {
    const copied = await copyToClipboard(line)
    writeLine(`\n${line}\n`)
    writeLine(
      copied.copied
        ? paint(`copied to your clipboard (${copied.how})`, 'dim')
        : paint(`${copied.how} — select it above`, 'dim'),
    )
    return EXIT.SUCCESS
  }

  const [command, ...rest] = argv
  const child = Bun.spawn([command ?? 'bun', ...rest], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env },
  })
  return await child.exited
}

if (import.meta.main) {
  /*
   * A wizard that cannot be escaped is a trap. Ctrl-C at any prompt leaves
   * raw mode behind it, so the terminal is usable afterwards.
   */
  const code = await main().catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`)
    return 1
  })
  if (process.stdin.isTTY) process.stdin.setRawMode(false)
  process.exit(code)
}
