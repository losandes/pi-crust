import { expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { listModelsOutput } from './pi-catalog-source'

for (const outcome of ['success', 'nonzero', 'missing'] as const) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given a catalogue executable that is ${outcome}`,
      'when reading its model list',
      'it should pass the arguments and environment and return only successful stdout',
    ].join(', '),
    () => {
      // given
      const dir = mkdtempSync(join(tmpdir(), 'crust-catalog-source-'))
      const binary = join(dir, 'fixture-pi')
      if (outcome !== 'missing') {
        writeFileSync(
          binary,
          [
            `#!${process.execPath}`,
            'process.stdout.write(JSON.stringify({ args: process.argv.slice(2), provider: process.env.FIXTURE_PROVIDER }))',
            `process.exit(${outcome === 'nonzero' ? 1 : 0})`,
            '',
          ].join('\n'),
        )
        chmodSync(binary, 0o755)
      }
      try {
        // when
        const output = listModelsOutput(binary, { FIXTURE_PROVIDER: 'fixture' })
        // then
        if (outcome === 'success') {
          expect(output).toBe(
            JSON.stringify({ args: ['--list-models'], provider: 'fixture' }),
          )
        } else {
          expect(output).toBeUndefined()
        }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
}
