import { expect, test } from 'bun:test'
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { runProgram } from './run-program'

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a fixture script',
    'when launched',
    'it should receive argv cwd and environment and return seven',
  ].join(', '),
  () => {
    // given
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'crust-bun-script-')))
    const script = join(root, 'fixture.ts')
    writeFileSync(
      script,
      `await Bun.write('receipt.json', JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), value: process.env.PROBE })); process.exit(7)`,
    )
    try {
      // when
      const result = runProgram({
        script,
        args: ['two words'],
        cwd: root,
        env: { PATH: process.env.PATH, HOME: root, PROBE: 'value' },
      })
      // then
      expect(result).toBe(7)
      expect(
        JSON.parse(readFileSync(join(root, 'receipt.json'), 'utf8')),
      ).toEqual({ args: ['two words'], cwd: root, value: 'value' })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a missing executable',
    'when launched',
    'it should return failure',
  ].join(', '),
  () => {
    // given
    // when
    const result = runProgram({
      script: '/absent.ts',
      args: [],
      cwd: '/',
      env: { PATH: '/nonexistent' },
    })
    // then
    expect(result).toBe(1)
  },
)
