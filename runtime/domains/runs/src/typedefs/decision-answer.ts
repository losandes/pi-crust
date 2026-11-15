import { z } from 'zod'

export const ANSWER_RECORD_FILENAME = 'decision-answer.json'

export const decisionAnswerSchema = z.object({
  verb: z.enum(['approve', 'reject', 'answer']),
  at: z.string().datetime(),
  from: z.string(),
})

export type TDecisionAnswer = Readonly<z.infer<typeof decisionAnswerSchema>>
