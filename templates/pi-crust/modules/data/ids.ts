/** Random identifiers. Reads the system CSPRNG, so it lives in data/. */

import { randomBytes } from 'node:crypto'

export const newId = (length = 8): string =>
  randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length)
