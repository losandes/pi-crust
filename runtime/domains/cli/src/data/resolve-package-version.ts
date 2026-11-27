import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  safeParseSettlement,
  type TSettlement,
} from '../../../../../lib/typedefs'

const manifestSchema = z.object({ version: z.string().min(1) })

export const resolvePackageVersion = (
  packageRoot: string,
): TSettlement<string> =>
  safeParseSettlement(
    () =>
      manifestSchema.parse(
        JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')),
      ).version,
  )
