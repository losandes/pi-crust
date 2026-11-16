import { expect, mock, test } from 'bun:test'
import { withSuitePage } from './browser'

test(
  [
    'given withSuitePage and a suite that was never opened',
    'when a page is requested',
    'it should reject without running the check',
  ].join(', '),
  async () => {
    // given
    const check = mock(() => Promise.resolve('ran'))

    // when
    const actual = withSuitePage(undefined)({}, check)

    // then
    await expect(actual).rejects.toThrow(
      'the browser suite is not open: browser tests are disabled',
    )
    expect(check).not.toHaveBeenCalled()
  },
)
