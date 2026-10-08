import { expect, test } from 'bun:test'
import { crustConfigSchema } from '../typedefs/config'
import type { TRun } from '../typedefs/run'
import { runVerification, verificationEnvelope } from './run-checks'

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
    expect(verificationEnvelope(actual, 0).summary).toContain('nothing changed')
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
    expect(verificationEnvelope(actual, 1).summary).toContain(
      'no routing.checks matched them',
    )
  },
)
