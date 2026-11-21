import { join } from 'node:path'

/** Extensions always come from this package, never from repository overrides. */
export const packageExtensionPath = (name: string): string =>
  join(import.meta.dir, '..', '..', '..', '..', 'extensions', name)
