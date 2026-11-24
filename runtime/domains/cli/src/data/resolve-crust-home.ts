import { existsSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { ownProgram } from '../../../../lib/system'

export type TCrustHome =
  | Readonly<{ kind: 'own' }>
  | Readonly<{ kind: 'other'; cli: string }>
  | Readonly<{ kind: 'invalid'; home: string }>

export const resolveCrustHome = (
  value: string | undefined,
  cwd: string,
  packageRoot: string,
): TCrustHome => {
  const configured = value?.trim()
  if (!configured) return { kind: 'own' }
  const home = resolve(cwd, configured)
  if (existsSync(home) && realpathSync(home) === realpathSync(packageRoot))
    return { kind: 'own' }
  const cli = resolve(home, ownProgram('runtime/cli.ts'))
  return existsSync(cli) ? { kind: 'other', cli } : { kind: 'invalid', home }
}
