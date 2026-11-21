import { expect, test } from 'bun:test'
import { main } from './answer'

test(
  [
    'given answer without a run id',
    'when executing its entry function',
    'it should return the usage exit code',
  ].join(', '),
  async () => {
    // given
    const argv: readonly string[] = []
    // when
    const actual = await main(argv)
    // then
    expect(actual).toBe(2)
  },
)
