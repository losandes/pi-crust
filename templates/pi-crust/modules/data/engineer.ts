/** Who is running this — the engineer lane's label. */

import { spawnSync } from 'node:child_process'

export const engineerName = (): string => {
  const configured = (process.env.ENGINEER_NAME ?? '').trim()
  if (configured) {
    return configured
  }
  const result = spawnSync('git', ['config', 'user.name'], {
    encoding: 'utf8',
    timeout: 5_000,
  })
  const fromGit = (result.stdout ?? '').trim()
  if (result.status === 0 && fromGit) {
    return fromGit
  }
  return process.env.USER ?? 'engineer'
}
