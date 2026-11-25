#!/usr/bin/env bun
import { safeParseSettlement } from '../../lib/typedefs'
import {
  askMenuChoice,
  askOne,
  askOrder,
  askText,
  askWhichRun,
  dispatchArgv,
  NEW_RUN,
  planNewRun,
  planResume,
  runProgram,
  shellLine,
} from '../domains/cli'
import { loadConfig } from '../domains/config'
import { resolveWaitingRuns } from '../domains/trace'
import { packageProgram } from '../lib/system'

/**
 * `crust please` — the command builder.
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
 *     crust please
 */

import { repoRoot, resolveLookupPaths } from '../domains/workspace'
import { DEFAULT_CONFIG_PATH } from '../lib/contracts'
import { configPathFromEnv, dbPathFromEnv, type TEnv } from '../lib/system'
import { box, copyToClipboard, paint, writeLine } from '../lib/terminal'

const DEFAULT_DB = '.pi-crust/data/crust.db'

const EXIT = { SUCCESS: 0, CANCELLED: 130 } as const

type TPleaseDeps = Readonly<{
  env: TEnv
  cwd: string
  cli: string
  askOne: typeof askOne
  askText: typeof askText
  askOrder: typeof askOrder
  askMenuChoice: typeof askMenuChoice
  copy: typeof copyToClipboard
  run: typeof runProgram
}>

const LIVE_DEPS: TPleaseDeps = {
  env: process.env,
  cwd: process.cwd(),
  cli: packageProgram('runtime/cli.ts'),
  askOne,
  askText,
  askOrder,
  askMenuChoice,
  copy: copyToClipboard,
  run: runProgram,
}

export const main = (deps: TPleaseDeps) => async (): Promise<number> => {
  // biome-ignore lint/plugin/no-intermediate-try-catch: main is the process boundary that maps wizard failures to an exit status
  try {
    const cfg = safeParseSettlement(() =>
      loadConfig(configPathFromEnv(deps.env) ?? DEFAULT_CONFIG_PATH),
    )
    const dbPath =
      cfg.status === 'ok'
        ? resolveLookupPaths(cfg.data, repoRoot()).db
        : (dbPathFromEnv(deps.env) ?? DEFAULT_DB)

    const ports = {
      askOne: deps.askOne,
      askText: deps.askText,
      askOrder: deps.askOrder,
      askMenuChoice: deps.askMenuChoice,
    }
    const which = await askWhichRun(ports)(resolveWaitingRuns(dbPath))
    if (which === undefined) {
      writeLine(paint('nothing started.', 'dim'))
      return EXIT.CANCELLED
    }

    const argv =
      which === NEW_RUN
        ? await planNewRun(ports)(
            configPathFromEnv(deps.env) ?? DEFAULT_CONFIG_PATH,
          )
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
    const go = await deps.askOne('go?', [
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
      const copied = await deps.copy(line)
      writeLine(`\n${line}\n`)
      writeLine(
        copied.copied
          ? paint(`copied to your clipboard (${copied.how})`, 'dim')
          : paint(`${copied.how} — select it above`, 'dim'),
      )
      return EXIT.SUCCESS
    }

    return deps.run({
      script: deps.cli,
      args: dispatchArgv(argv),
      cwd: deps.cwd,
      env: deps.env,
    })
  } catch (error) {
    process.stderr.write(`${String(error)}\n`)
    return 1
  }
}

if (import.meta.main) {
  /*
   * A wizard that cannot be escaped is a trap. Ctrl-C at any prompt leaves
   * raw mode behind it, so the terminal is usable afterwards.
   */
  const code = await main(LIVE_DEPS)()
  if (process.stdin.isTTY) process.stdin.setRawMode(false)
  process.exit(code)
}
