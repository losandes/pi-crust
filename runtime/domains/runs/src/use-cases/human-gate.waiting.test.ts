import { expect, test } from 'bun:test'
import { TRUST_DEFAULT } from '../../../../lib/contracts'
import { gateReason } from './human-gate'
import { QUESTION, work } from './human-gate-fixture.test'

for (const status of ['success', 'fail'] as const) {
  test(
    [
      `given #117 AC1: a ${status} envelope with blocking questions and requested approval`,
      'when the human gate evaluates mixed answerable and unanswerable questions',
      'it should escalate only the blocking questions rather than treat unfinished work as an approval',
    ].join(', '),
    () => {
      // given
      const external = {
        question: 'May I publish the retention policy?',
        consequential: true,
        beyond_this_run: true,
        provisional_answer: 'Publish the approved policy',
      }
      const envelope = work({
        status,
        unresolved: [
          {
            ...QUESTION,
            question: 'Which local fixture name should I use?',
            provisional_answer: 'retention-policy',
          },
          QUESTION,
          external,
        ],
      })

      // when
      const actual = gateReason({
        activity: 'build',
        envelope,
        approveAfter: ['build'],
        hasSuccessor: true,
        trust: TRUST_DEFAULT,
      })

      // then
      expect(actual).toEqual({
        kind: 'escalated',
        activity: 'build',
        questions: [QUESTION.question, external.question],
      })
    },
  )
}
