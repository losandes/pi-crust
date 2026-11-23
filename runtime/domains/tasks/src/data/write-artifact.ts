import { randomUUID } from 'node:crypto'
import {
  closeSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { safeParseSettlement } from '../../../../../lib/typedefs'

export const temporaryArtifactName = (path: string): string =>
  `${path}.${process.pid}.${randomUUID()}.tmp`

export const writeArtifact =
  (temporaryName: (path: string) => string) =>
  (path: string, text: string): void => {
    const temporary = temporaryName(path)
    const fd = openSync(temporary, 'wx')
    const replaced = safeParseSettlement(() => {
      try {
        writeFileSync(fd, text)
      } finally {
        closeSync(fd)
      }
      renameSync(temporary, path)
    })
    if (replaced.status === 'error') {
      safeParseSettlement(() => unlinkSync(temporary))
      throw replaced.error
    }
  }
