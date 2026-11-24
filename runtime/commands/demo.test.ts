import { expect, test } from 'bun:test'
import { main } from './demo'

for (const [statuses, expected, writes] of [
  [[0, 0], 0, 3],
  [[7], 7, 1],
  [[0, 5], 5, 2],
] as const) {
  test(
    [
      `given demo statuses ${statuses}`,
      `when run`,
      `it should stop at the first failure`,
    ].join(', '),
    () => {
      // given
      let calls: unknown[] = []
      let output: string[] = []
      const deps = {
        env: {},
        cwd: '/repo',
        run: (run: Readonly<{ args: readonly string[] }>) => {
          calls = [...calls, run]
          return statuses[calls.length - 1] ?? 0
        },
        write: (text: string) => (output = [...output, text]),
      }
      // when
      const result = main(deps)(['--config', 'alt.toml'])
      // then
      expect(result).toBe(expected)
      expect(output).toHaveLength(writes)
      expect(calls).toHaveLength(statuses.length)
      expect(calls[0]).toMatchObject({
        cwd: '/repo',
        args: [
          '--config',
          'alt.toml',
          'list the top-level directories in this repo and what each is for. change nothing.',
          '--activities',
          'scout',
        ],
      })
      if (statuses.length === 2)
        expect(calls[1]).toMatchObject({
          args: [
            '--config',
            'alt.toml',
            'state the outcome a newcomer to this repo would want from it, and how they would know they had it',
            '--activities',
            'identify',
          ],
        })
      expect(output[0]).toBe('1/2  scout: read-only recon\n')
      if (expected === 0)
        expect(output[2]).toBe(
          '\nboth done. now run:  crust sessions    (or: crust observe)\n',
        )
    },
  )
}

for (const env of [{}, { CRUST_CONFIG: 'env.toml' }]) {
  test(
    [
      `given demo environment ${JSON.stringify(env)}`,
      `when no config flag is supplied`,
      `it should choose its default`,
    ].join(', '),
    () => {
      // given
      let calls: Readonly<{ args: readonly string[] }>[] = []
      // when
      const result = main({
        env,
        cwd: '/repo',
        run: (run) => {
          calls = [...calls, run]
          return 0
        },
        write: () => {},
      })([])
      // then
      expect(result).toBe(0)
      expect(calls[0]?.args[1]).toBe(env.CRUST_CONFIG ?? 'pi-crust.toml')
    },
  )
}
