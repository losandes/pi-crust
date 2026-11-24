import { join } from 'node:path'
import { packageProgram } from '../../../../lib/system'

/** Extensions always come from this package, never from repository overrides. */
export const packageExtensionPath = (name: string): string =>
  packageProgram(join('runtime/extensions', name))
