import { expect, test } from 'bun:test'
import { DELIVERY_GATES } from './delivery-gates'

for (const given of [
  {
    action: 'created',
    url: 'https://example.test/pull/125',
    reason: '',
    ok: true,
    note: 'created https://example.test/pull/125',
  },
  {
    action: 'updated',
    url: 'https://example.test/pull/125',
    reason: '',
    ok: true,
    note: 'updated https://example.test/pull/125',
  },
  {
    action: 'refused',
    url: '',
    reason: 'the branch is not ahead of main',
    ok: false,
    note: 'none opened — the branch is not ahead of main',
  },
  {
    action: 'created',
    url: '',
    reason: '',
    ok: false,
    note: 'created reported no URL',
  },
  {
    action: 'updated',
    url: ' \n\t',
    reason: '',
    ok: false,
    note: 'updated reported no URL',
  },
  {
    action: 'skipped',
    url: 'https://example.test/pull/125',
    reason: '',
    ok: false,
    note: 'skipped reported no URL',
  },
]) {
  test(
    [
      `given terminal delivery reported ${given.action} with ${JSON.stringify(given.url)}`,
      'when the engine judges its delivery gates',
      `it should report ${given.ok ? 'a verified pull request' : 'the missing pull request'}`,
    ].join(', '),
    () => {
      // given
      const result = {
        action: given.action,
        url: given.url,
        reason: given.reason,
      }

      // when
      const actual = DELIVERY_GATES.map((gate) => ({
        name: gate.name,
        report: gate.check({ result }),
      }))

      // then
      expect(actual).toEqual([
        {
          name: 'pull_request_opened',
          report: {
            checks: [{ item: 'pull request', ok: given.ok, note: given.note }],
          },
        },
      ])
    },
  )
}
