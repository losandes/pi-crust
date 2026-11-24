import { devNull } from 'node:os'
import { resolve } from 'node:path'
import type { TSettlement } from '../../../../../lib/typedefs'
import type { TEnv } from '../../../../lib/system'
import type { TScriptRun } from '../data/run-bun-script'
import type { TRecipeDoc } from './recipe-docs'

export type TDispatchInput = Readonly<{
  argv: readonly string[]
  env: TEnv
  cwd: string
  packageRoot: string
  repositoryRoot: string | undefined
}>

export const planDispatch =
  (docs: readonly TRecipeDoc[]) =>
  (input: TDispatchInput): TSettlement<TScriptRun> => {
    const [name = 'default', ...args] = input.argv
    const doc = docs.find((entry) => entry.name === name)
    if (!doc)
      return {
        status: 'error',
        error: new Error(
          `crust: unknown command "${name}". Run \`crust help\` to list the commands.`,
        ),
      }
    const { run } = doc
    const missing = run.required[args.length]
    if (missing)
      return {
        status: 'error',
        error: new Error(
          `crust ${name}: missing <${missing}>.\nusage: ${doc.usage}`,
        ),
      }
    if (!run.rest && args.length > run.required.length)
      return {
        status: 'error',
        error: new Error(
          `crust ${name}: unexpected argument "${args[run.required.length]}".\nusage: ${doc.usage}`,
        ),
      }
    if (run.repository && !input.repositoryRoot)
      return {
        status: 'error',
        error: new Error(
          `crust ${name}: ${input.cwd} is not inside a Git repository. Run \`git init\` to create one, then \`crust init\` to set pi-crust up in it.`,
        ),
      }
    const config = input.repositoryRoot
      ? input.env.CRUST_CONFIG?.trim() || 'pi-crust.toml'
      : devNull
    return {
      status: 'ok',
      data: {
        script: resolve(input.packageRoot, run.script),
        args: [
          ...(run.config ? ['--config', config] : []),
          ...run.fixed,
          ...(run.repeat ? args.slice(0, run.required.length) : []),
          ...args,
        ],
        cwd: input.repositoryRoot ?? input.cwd,
      },
    }
  }
