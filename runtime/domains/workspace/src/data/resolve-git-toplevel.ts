import { spawnSync } from 'node:child_process'

export const resolveGitToplevel = (cwd: string): string | undefined => {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return result.status === 0 ? result.stdout.trim() : undefined
}
