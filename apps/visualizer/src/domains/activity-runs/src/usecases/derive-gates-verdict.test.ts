import { expect, test } from 'bun:test'
import { deriveGatesVerdict } from './derive-gates-verdict'

for (const { name, gates, expected } of [
  { name: 'no gate result', gates: [], expected: undefined },
  {
    name: 'one result that passed',
    gates: [{ passed: 1 }],
    expected: 'passed',
  },
  {
    name: 'every result passed',
    gates: [{ passed: 1 }, { passed: 1 }, { passed: 1 }],
    expected: 'passed',
  },
  {
    name: 'one failure among passes',
    gates: [{ passed: 1 }, { passed: 0 }, { passed: 1 }],
    expected: 'failed',
  },
  {
    name: 'a result with no verdict',
    gates: [{ passed: null }],
    expected: 'failed',
  },
  {
    name: 'no verdict among passes',
    gates: [{ passed: 1 }, { passed: null }],
    expected: 'failed',
  },
  {
    name: 'every result failed',
    gates: [{ passed: 0 }, { passed: 0 }],
    expected: 'failed',
  },
] as const) {
  test(
    [
      `given ${name}`,
      'when deriving the overall gates verdict',
      `it should return ${expected ?? 'undefined'}`,
    ].join(', '),
    () => {
      // given
      const input = gates

      // when
      const actual = deriveGatesVerdict(input)

      // then
      expect(actual).toBe(expected)
    },
  )
}
