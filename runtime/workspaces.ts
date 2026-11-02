#!/usr/bin/env bun
/**
 * The working trees this machine has run the factory in.
 *
 * A run registers its own tree as it starts, so this is a record of where
 * work has happened rather than a list anybody maintains. The observer reads
 * the same file and watches every tree in it.
 *
 *   just crust trees                      list them
 *   just crust forget-tree <path>...      drop one or more
 *
 * Forgetting is explicit and never automatic. A tree whose database cannot be
 * opened right now looks exactly like one on an unmounted volume, or one that
 * has merely moved — so an unreachable tree stays listed, and says so, rather
 * than disappearing on its own.
 */

import { fileExists } from './modules/data/files'
import {
  forgetWorkspaces,
  readRegistry,
  registryPath,
} from './modules/data/workspace-registry'

const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const list = (): void => {
  const path = registryPath()
  const entries = readRegistry(path)
  if (entries.length === 0) {
    say(`no trees registered yet (${path})`)
    say('a tree registers itself the first time a lifecycle runs in it.')
    return
  }
  say(`${entries.length} tree(s) registered in ${path}`)
  for (const entry of entries) {
    // Reachability is reported, never acted on: this command says what it
    // sees, and only the developer decides what to forget.
    const mark = fileExists(entry.db) ? ' ' : '!'
    say(`${mark} ${entry.root}`)
    say(`    ${entry.db}${fileExists(entry.db) ? '' : '  (unreachable)'}`)
  }
}

const forget = (targets: readonly string[]): void => {
  if (targets.length === 0) {
    say('name at least one tree to forget, by its root or its database path.')
    process.exitCode = 1
    return
  }
  const before = readRegistry().length
  const kept = forgetWorkspaces(targets)
  say(`forgot ${before - kept.length} of ${before}; ${kept.length} remain.`)
  say("nothing on disk was deleted — only this machine's list of trees.")
}

const [command, ...rest] = process.argv.slice(2)
if (command === 'forget') forget(rest)
else if (command === undefined || command === 'list') list()
else {
  say(`unknown command ${command} — expected "list" or "forget <path>..."`)
  process.exitCode = 1
}
