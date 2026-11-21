#!/usr/bin/env bun
import { runPiPrint } from '../domains/agents'
import { consultActivity } from '../domains/runs'
export const main = (argv: readonly string[]): Promise<number> =>
  consultActivity({
    env: process.env,
    cwd: process.cwd(),
    invoke: runPiPrint,
    say: (line) => {
      process.stdout.write(`${line}\n`)
    },
  })('ask', argv)
if (import.meta.main) process.exitCode = await main(process.argv.slice(2))
