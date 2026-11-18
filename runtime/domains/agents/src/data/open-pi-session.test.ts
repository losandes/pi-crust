import { expect, test } from 'bun:test'
import { openPiSession } from './open-pi-session'

for (const code of [7, 0]) {
  test(
    [
      'given openPiSession and an executable',
      `when it exits with ${code}`,
      'it should settle with the child exit code',
    ].join(', '),
    async () => {
      // given
      const argv = [process.execPath, '-e', code === 0 ? '' : 'process.exit(7)']

      // when
      const actual = await openPiSession(argv)

      // then
      expect(actual).toEqual({ status: 'ok', data: code })
    },
  )
}

test(
  [
    'given openPiSession and a missing binary',
    'when spawning it',
    'it should settle with an error instead of throwing',
  ].join(', '),
  async () => {
    // given
    const argv = ['/no-such-crust-pi-binary']

    // when
    const actual = await openPiSession(argv)

    // then
    expect(actual.status).toBe('error')
    if (actual.status === 'error') expect(actual.error).toBeInstanceOf(Error)
  },
)
