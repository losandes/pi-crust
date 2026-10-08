/**
 * Running the repository's own checks, deterministically.
 *
 * A known command is not a judgement call. Anything whose invocation you can
 * write down runs here as code — in milliseconds, for nothing, with the same
 * answer every time. Agents are for the parts that need reading and deciding.
 *
 * Every command comes from `routing.checks` in the config. This file names no
 * test runner, no linter and no build tool, because crust is stamped into
 * repositories whose toolchain it cannot know — and a wrong-but-plausible
 * command that silently passes is worse than no check at all.
 *
 * Two rules for the commands you declare there:
 *
 *   1. An argv LIST, never a shell string — no quoting bugs, no injection.
 *   2. Bare binary names. These inherit the operator's environment (see
 *      data/operator-env.ts), so `bun`, `pnpm` and `just` resolve exactly as
 *      they do in your terminal. An absolute path bakes your machine into the
 *      trace.
 */


import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { monotonicMs, nowIso } from '../data/clock'
import { ensureDir, writeText } from '../data/files'
import { operatorEnv } from '../data/operator-env'
import type { TVerifyOutput } from '../typedefs/envelope'
import type {
  TQualityCheckResult,
  TQualityCheckSpec,
  TQualityResult,
} from '../typedefs/quality'
import type { TRun } from '../typedefs/run'
import { matchingChecks } from './route-by-path'

/**
 * How much of a failing command's output rides back inside the envelope. Enough
 * for a builder to act on without opening the artifact; bounded so a runaway
 * stack trace can't swamp the next agent's context.
 */
export const TAIL_CHARS = 4_000

/** Human-readable form of an argv list, for the `command` column. */
export const quoteArgv = (argv: readonly string[]): string =>
  argv
    .map((token) =>
      /^[\w./:=-]+$/.test(token) ? token : `'${token.replace(/'/g, `'\\''`)}'`,
    )
    .join(' ')

const checkDir = (run: TRun, name: string): string => {
  const seq = run.phases().at(-1)?.seq ?? 0
  return ensureDir(
    join(
      run.contextHandoffDir,
      'checks',
      `${String(seq).padStart(2, '0')}_${name}`,
    ),
  )
}

export const runCheck = (
  spec: TQualityCheckSpec,
  run: TRun,
): TQualityCheckResult => {
  const phase = run.phases().at(-1)
  const outputArtifact = join(checkDir(run, spec.name), 'command.log')
  const command = quoteArgv(spec.argv)
  const [binary, ...args] = spec.argv

  run.console.note(`check ${spec.name}: ${command}`)
  const startedAt = nowIso()
  const clock = monotonicMs()
  const completed = spawnSync(binary ?? '', args, {
    cwd: spec.cwd === '' ? run.repoRoot : join(run.repoRoot, spec.cwd),
    env: { ...operatorEnv() },
    encoding: 'utf8',
    timeout: spec.timeoutSeconds * 1000,
  })
  // A missing binary and a timeout both land here with the real message — no
  // pre-flight probe needed, and none wanted. 127 is "command not found",
  // 124 is the timeout convention.
  const timedOut =
    completed.error?.name === 'ETIMEDOUT' || completed.signal === 'SIGTERM'
  const returncode = timedOut
    ? 124
    : completed.error
      ? 127
      : (completed.status ?? 1)
  const stdout = completed.stdout ?? ''
  const stderr =
    (completed.stderr ?? '') +
    (timedOut ? `\nTimed out after ${spec.timeoutSeconds}s.` : '') +
    (completed.error && !timedOut ? String(completed.error.message) : '')

  const duration = (monotonicMs() - clock) / 1000
  writeText(
    outputArtifact,
    `$ ${command}\nexit: ${returncode}\nduration_seconds: ${duration.toFixed(3)}\n` +
      `\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`,
  )
  const passed = returncode === 0
  run.tracer.event({
    run_id: run.runId,
    phase_id: phase?.phase_id ?? '',
    type: 'tool_call',
    name: `quality:${spec.name}`,
    payload: {
      area: spec.area,
      operation: spec.operation,
      command,
      returncode,
      passed,
      output_artifact: outputArtifact,
    },
    started_at: startedAt,
    ended_at: nowIso(),
  })
  run.console.note(
    `quality ${spec.name}: ${passed ? 'passed' : 'failed'} ` +
      `(exit ${returncode}, ${duration.toFixed(1)}s)`,
  )
  return {
    name: spec.name,
    area: spec.area,
    operation: spec.operation,
    command,
    returncode,
    passed,
    durationSeconds: duration,
    outputArtifact,
    outputTail: `${stdout}${stderr}`.slice(-TAIL_CHARS),
  }
}

/** A failing check, in the words of the command that failed. */
export const failureOf = (check: TQualityCheckResult): string =>
  `${check.name}: \`${check.command}\` exited ${check.returncode}\n${check.outputTail}`.trimEnd()

/**
 * The checks the CHANGED PATHS select — the deterministic half of verification.
 *
 * Three outcomes, and the middle one is the reason this function exists:
 *
 *   | changed paths | matched checks | verdict                               |
 *   |---------------|----------------|---------------------------------------|
 *   | none          | —              | passed: nothing changed, none apply   |
 *   | some          | 0              | FAILED: nothing was actually verified |
 *   | some          | N              | the real verdict                      |
 *
 * A repository that forgot to declare `routing.checks` would otherwise get a
 * green verify forever. Zero checks passing is not the same claim as zero
 * checks failing, and only one of them is evidence.
 */
export const runVerification = (
  run: TRun,
  changedPaths: readonly string[],
): TQualityResult => {
  if (changedPaths.length === 0) {
    return { passed: true, checks: [], failures: [], artifacts: [] }
  }
  const specs = matchingChecks(run.cfg, changedPaths)
  if (specs.length === 0) {
    return {
      passed: false,
      checks: [],
      failures: [
        `${changedPaths.length} path(s) changed but no routing.checks ` +
          'matched them — add a rule to routing.checks in crust.config.yaml, ' +
          'or narrow the change. Nothing was verified.',
      ],
      artifacts: [],
    }
  }
  const checks = specs.map((spec) => runCheck(spec, run))
  return {
    passed: checks.every((check) => check.passed),
    checks,
    failures: checks.filter((check) => !check.passed).map(failureOf),
    artifacts: checks.map((check) => check.outputArtifact),
  }
}

/**
 * The result as an envelope, with a summary that tells the three outcomes apart.
 *
 * Agents hand each other typed envelopes and this returns one, so a failing
 * check reaches the next agent through exactly the door an agent's own report
 * would use. Only the step knows the difference.
 */
export const verificationEnvelope = (
  result: TQualityResult,
  changedCount: number,
): TVerifyOutput => {
  const base: TVerifyOutput = {
    status: result.passed ? 'success' : 'fail',
    summary: result.passed
      ? `verification: all ${result.checks.length} check(s) passed`
      : `verification: ${result.failures.length} of ${result.checks.length} check(s) failed`,
    artifacts: [...result.artifacts],
    notes_for_next_agent: result.passed
      ? ''
      : 'Fix every failure below. The output is verbatim from the command — ' +
        'trust it over any summary.',
    passed: result.passed,
    failures: [...result.failures],
  }
  if (changedCount === 0) {
    return {
      ...base,
      summary: 'verification: nothing changed, no checks apply',
    }
  }
  if (result.checks.length === 0) {
    return {
      ...base,
      summary:
        `verification: ${changedCount} path(s) changed but no ` +
        'routing.checks matched them',
    }
  }
  return base
}
