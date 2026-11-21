import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { safeParseSettlement } from '../../../../../lib/typedefs'

const sessionHeaderSchema = z.object({
  type: z.literal('session'),
  id: z.string(),
})

export const resolvePiSessionFileById =
  (sessionDir: string) =>
  (sessionId: string): string | undefined => {
    const entries = safeParseSettlement(() => readdirSync(sessionDir))
    if (entries.status === 'error') return undefined
    return entries.data
      .filter((name) => name.endsWith('.jsonl'))
      .toSorted()
      .map((name) => resolve(sessionDir, name))
      .find((path) => {
        const header = safeParseSettlement(() =>
          JSON.parse(readFileSync(path, 'utf8').split('\n')[0] ?? ''),
        )
        if (header.status === 'error') return false
        const parsed = sessionHeaderSchema.safeParse(header.data)
        return parsed.success && parsed.data.id === sessionId
      })
  }
