import { expect, test } from 'bun:test'
import { crustConfigSchema } from '../typedefs/config'
import type { TRun } from '../typedefs/run'
import { runVerification } from './run-checks'

/** `runVerification` reads only the config in the two no-command cases. */
const runWith = (routing: Readonly<Record<string, unknown>>): TRun =>
  ({
    cfg: crustConfigSchema.parse({ routing, agents: [] }),
  }) as unknown as TRun

test(
  [
    'given use-cases/run-checks::runVerification',
    'when nothing changed',
    'it should pass without claiming any check ran',
  ].join(', '),
  () => {
    // given
    const run = runWith({ checks: [] })

    // when
    const actual = runVerification(run, [])

    // then
    expect(actual.passed).toEqual(true)
    expect(actual.checks).toEqual([])
    expect(actual.failures).toEqual([])
  },
)

test(
  [
    'given use-cases/run-checks::runVerification',
    'when paths changed but no declared check matched them',
    'it should FAIL, because nothing was actually verified',
  ].join(', '),
  () => {
    // given a rule that cannot reach a nested file
    const run = runWith({
      checks: [
        { name: 'lint', when: ['*.ts'], operation: 'lint', argv: ['true'] },
      ],
    })

    // when
    const actual = runVerification(run, ['src/deep/a.ts'])

    // then
    expect(actual.passed).toEqual(false)
    expect(actual.failures[0]).toContain('no routing.checks matched')
  },
)

test(
  [
    'given use-cases/run-checks::runVerification',
    'when the repository has declared no checks at all',
    'it should pass, because nothing was promised and nothing is evidence',
  ].join(', '),
  () => {
    // given — `checks: []` is what an install stamps, and crust.config.yaml
    // is in protected_files, so a build agent met a gate it could not pass
    // and was not allowed to fix
    const run = runWith({ checks: [] })

    // when
    const actual = runVerification(run, ['src/add.ts', 'src/add.test.ts'])

    // then
    expect(actual.passed).toEqual(true)
    expect(actual.checks).toEqual([])
    expect(actual.failures).toEqual([])
  },
)

test(
  [
    'given use-cases/run-checks::runVerification',
    'when one rule is declared and this change falls outside it',
    'it should still FAIL, because that is a gap rather than an abstention',
  ].join(', '),
  () => {
    // given — declaring nothing and declaring a rule that misses are
    // different claims, and only the second is evidence of a gap
    const run = runWith({
      checks: [
        { name: 'lint', when: ['**/*.md'], operation: 'lint', argv: ['true'] },
      ],
    })

    // when
    const actual = runVerification(run, ['src/add.ts'])

    // then
    expect(actual.passed).toEqual(false)
    expect(actual.failures[0]).toContain('no routing.checks matched')
  },
)
