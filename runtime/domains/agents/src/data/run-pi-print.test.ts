import { expect, test } from 'bun:test'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { runPiPrint } from './run-pi-print'

for (const code of [0, 1]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given a print subprocess exiting ${code}`,
      'when collecting its output',
      'it should combine both streams and preserve success status',
    ].join(', '),
    async () => {
      // given
      const argv = [
        process.execPath,
        '-e',
        `process.stdout.write('out'); process.stderr.write('err'); process.exitCode=${code}`,
      ]

      // when
      const actual = await runPiPrint(argv, process.cwd())

      // then
      expect(actual.ok).toBe(code === 0)
      expect(actual.output).toContain('out')
      expect(actual.output).toContain('err')
    },
  )
}
