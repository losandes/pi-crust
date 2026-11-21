import { forgetWorkspaces, readRegistry } from '../domains/workspace'

const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}
export const main = (targets: readonly string[]): void => {
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
if (import.meta.main) main(process.argv.slice(2))
