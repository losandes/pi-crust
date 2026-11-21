import { join } from 'node:path'
import {
  safeParseSettlement,
  type TSettlement,
} from '../../../../../lib/typedefs'
import { fileExists, readText } from '../../../../lib/system'
import {
  ANSWER_RECORD_FILENAME,
  decisionAnswerSchema,
  type TDecisionAnswer,
} from '../typedefs/decision-answer'

export const resolveDecisionAnswer = (
  handoffDir: string,
): TSettlement<TDecisionAnswer | undefined> => {
  const path = join(handoffDir, ANSWER_RECORD_FILENAME)
  return safeParseSettlement(() =>
    fileExists(path)
      ? decisionAnswerSchema.parse(JSON.parse(readText(path)))
      : undefined,
  )
}
