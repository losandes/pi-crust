import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseEnv } from 'node:util'
import type { TEnv } from '../../../../lib/system'

const readEnv = (path: string): TEnv =>
  existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {}

export const resolveEnvFiles = (cwd: string): TEnv => {
  if (existsSync(join(cwd, '.env')) || existsSync(join(cwd, '.env.local'))) {
    return {
      ...readEnv(join(cwd, '.env')),
      ...readEnv(join(cwd, '.env.local')),
    }
  }
  const parent = dirname(cwd)
  return parent === cwd ? {} : resolveEnvFiles(parent)
}
