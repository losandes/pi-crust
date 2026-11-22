import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TRun } from '../../../../lib/contracts'
import { crustConfigSchema } from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { runCommand, runVerification } from './run-checks'

/** `runVerification` reads only the config in the two no-command cases. */
const runWith = (routing: Readonly<Record<string, unknown>>): TRun =>
  ({
    cfg: crustConfigSchema.parse({ routing, agents: [] }),
  }) as unknown as TRun

/**
 * A run that can actually shell out, for the cases where a declared check
 * runs for real — matched paths, whether the command passes or fails.
 */
const runnableWith = (routing: Readonly<Record<string, unknown>>): TRun => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-run-checks-'))

  return {
    cfg: crustConfigSchema.parse({ routing, agents: [] }),
    runId: 'aaaa1111',
    repoRoot: dir,
    contextHandoffDir: dir,
    activityRuns: () => [],
    console: { note: () => undefined },
    tracer: { event: () => undefined },
  } as unknown as TRun
}

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
    'it should PASS, because a repository that opted in and left a gap is a reporting problem, not a failure (1.1.1)',
  ].join(', '),
  () => {
    // given a rule that cannot reach a nested file
    const run = runWith({
      checks: [{ name: 'lint', when: ['*.ts'], argv: ['true'] }],
    })

    // when
    const actual = runVerification(run, ['src/deep/a.ts'])

    // then
    expect(actual.passed).toEqual(true)
  },
)

test(
  [
    'given use-cases/run-checks::runVerification',
    'when paths changed but no declared check matched them',
    'it should still say so, because zero checks run is not the same claim as zero checks failing (1.1.2)',
  ].join(', '),
  () => {
    // given
    const run = runWith({
      checks: [{ name: 'lint', when: ['*.ts'], argv: ['true'] }],
    })

    // when — the path never reaches a declared rule
    const actual = runVerification(run, ['src/deep/a.ts'])

    // then — the result carries SOMETHING naming the gap; a passing result
    // that looks identical to "0 checks, all passed" would make this
    // indistinguishable from real coverage
    expect(actual.passed).toEqual(true)
    expect(actual.checks).toEqual([])
    expect(JSON.stringify(actual)).toContain('src/deep/a.ts')
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
    'it should still PASS, because declaring nothing and declaring a rule that misses are different claims (1.1.1)',
  ].join(', '),
  () => {
    // given — declaring nothing and declaring a rule that misses are
    // different claims, but neither is evidence of a failure under the
    // default policy
    const run = runWith({
      checks: [{ name: 'lint', when: ['**/*.md'], argv: ['true'] }],
    })

    // when
    const actual = runVerification(run, ['src/add.ts'])

    // then
    expect(actual.passed).toEqual(true)
  },
)

test(
  [
    'given use-cases/run-checks::runVerification',
    'when a declared check matches the changed paths and the command fails',
    'it should FAIL, so an unmatched change settling as passed cannot be read as checks being advisory (1.1.1, 1.4.4)',
  ].join(', '),
  () => {
    // given
    const run = runnableWith({
      checks: [
        {
          name: 'tests',
          when: ['**/*.ts'],
          argv: ['sh', '-c', 'echo "1 test failed" && exit 1'],
        },
      ],
    })

    // when
    const actual = runVerification(run, ['src/a.ts'])

    // then
    expect(actual.passed).toEqual(false)
    expect(actual.failures[0]).toContain('tests:')
  },
)

test(
  [
    'given use-cases/run-checks::runVerification',
    'when a declared check matches the changed paths and the command passes',
    'it should PASS, and say which check ran',
  ].join(', '),
  () => {
    // given
    const run = runnableWith({
      checks: [
        {
          name: 'typecheck',
          when: ['**/*.ts'],
          argv: ['true'],
        },
      ],
    })

    // when
    const actual = runVerification(run, ['src/a.ts'])

    // then
    expect(actual.passed).toEqual(true)
    expect(actual.checks[0]?.name).toEqual('typecheck')
  },
)

test(
  [
    'given use-cases/run-checks::runVerification',
    'when a repository has opted into routing.unmatched: "block"',
    'it should FAIL on an uncovered change, because 1.3.1 makes that a declared choice rather than the default (1.4.3)',
  ].join(', '),
  () => {
    // given — the opt-in setting lives beside the rules it governs (1.3.1)
    const run = runWith({
      unmatched: 'block',
      checks: [{ name: 'lint', when: ['**/*.md'], argv: ['true'] }],
    })

    // when
    const actual = runVerification(run, ['src/add.ts'])

    // then
    expect(actual.passed).toEqual(false)
  },
)

test(
  [
    'given use-cases/run-checks::runCommand',
    'when called with no note callback',
    "it should still run the command, using a no-op in the note's place",
  ].join(', '),
  () => {
    // given — the caller is `just crust verify`, which has no console to
    // write progress to
    const dir = mkdtempSync(join(tmpdir(), 'crust-run-command-'))

    // when
    const actual = runCommand(
      {
        name: 'ok',
        argv: ['true'],
        cwd: '',
        timeoutSeconds: 5,
      },
      { repoRoot: dir, outputArtifact: join(dir, 'command.log') },
    )

    // then
    expect(actual.passed).toBe(true)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a repository command declared without labels',
    'when its matching command exits non-zero',
    'it should preserve failure evidence without operation or area',
  ].join(', '),
  () => {
    // given
    const run = runnableWith({
      checks: [
        { name: 'unlabelled', when: ['**/*.ts'], argv: ['sh', '-c', 'exit 7'] },
      ],
    })
    try {
      // when
      const actual = runVerification(run, ['src/a.ts'])

      // then
      expect(actual.passed).toBe(false)
      expect(actual.failures[0]).toContain('unlabelled:')
      expect(actual.failures[0]).toContain("sh -c 'exit 7'")
      expect(actual.failures[0]).toContain('exited 7')
      expect(actual.checks[0]).not.toHaveProperty('operation')
      expect(actual.checks[0]).not.toHaveProperty('area')
    } finally {
      rmSync(run.repoRoot, { recursive: true, force: true })
    }
  },
)
