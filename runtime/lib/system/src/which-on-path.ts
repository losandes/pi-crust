import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { safeParseSettlement } from '../../../../lib/typedefs'

export const whichOnPath = (
  name: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined =>
  (env.PATH ?? '')
    .split(delimiter)
    .map((directory) => join(directory, name))
    .find((path) => {
      const executable = safeParseSettlement(() => {
        accessSync(path, constants.X_OK)
        return statSync(path).isFile()
      })
      return executable.status === 'ok' && executable.data
    })
