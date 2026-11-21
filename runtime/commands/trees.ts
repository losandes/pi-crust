import { readRegistry, registryPath } from '../domains/workspace'
import { fileExists } from '../lib/system'

const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}
export const main = (): void => {
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
if (import.meta.main) main()
