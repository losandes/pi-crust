#!/usr/bin/env bun
/**
 * make-config — generate the repository's commented pi-crust.toml template.
 *
 * Usage:
 *     bun <pi-crust>/scripts/make-config.ts [--force]
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const TEMPLATE = resolve(
  dirname(new URL(import.meta.url).pathname),
  '..',
  'templates',
  'pi-crust.toml',
)

const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const main = (): number => {
  const force = process.argv.includes('--force')
  const destination = join(process.cwd(), 'pi-crust.toml')
  if (existsSync(destination) && !force) {
    say(`${destination} already exists — use --force to overwrite`)
    return 1
  }
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(TEMPLATE, destination)
  say(`wrote ${destination}`)
  return 0
}

if (import.meta.main) {
  process.exit(main())
}
