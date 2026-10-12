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
  const seq = run.activityRuns().at(-1)?.seq ?? 0
  return ensureDir(
    join(
      run.contextHandoffDir,
      'checks',
      `${String(seq).padStart(2, '0')}_${name}`,
    ),
  )
}

/**
 * One command, run. No run, no trace, no session.
 *
 * Split out so the same commands can be run from `just crust verify`, which
 * has none of those things and wants only the exit status. The `checks` gate
 * wraps this with the trace events a run expects.
 */
export const runCommand = (
  spec: TQualityCheckSpec,
  params: Readonly<{ repoRoot: string; outputArtifact: string; note?: (line: string) => void }>,
): TQualityCheckResult => {
  const note = params.note ?? (() => undefined)
  const command = quoteArgv(spec.argv)
  const [binary, ...args] = spec.argv

  note(`check ${spec.name}: ${command}`)
  const clock = monotonicMs()
  const completed = spawnSync(binary ?? '', args, {
    cwd: spec.cwd === '' ? params.repoRoot : join(params.repoRoot, spec.cwd),
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
    params.outputArtifact,
    `$ ${command}\nexit: ${returncode}\nduration_seconds: ${duration.toFixed(3)}\n` +
      `\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`,
  )
  const passed = returncode === 0
  note(
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
    outputArtifact: params.outputArtifact,
    outputTail: `${stdout}${stderr}`.slice(-TAIL_CHARS),
  }
}

export const runCheck = (
  spec: TQualityCheckSpec,
  run: TRun,
): TQualityCheckResult => {
  const activityRun = run.activityRuns().at(-1)
  const startedAt = nowIso()
  const result = runCommand(spec, {
    repoRoot: run.repoRoot,
    outputArtifact: join(checkDir(run, spec.name), 'command.log'),
    note: (line) => run.console.note(line),
  })
  run.tracer.event({
    run_id: run.runId,
    activity_run_id: activityRun?.activity_run_id ?? '',
    type: 'tool_call',
    name: `quality:${spec.name}`,
    payload: {
      area: spec.area,
      operation: spec.operation,
      command: result.command,
      returncode: result.returncode,
      passed: result.passed,
      output_artifact: result.outputArtifact,
    },
    started_at: startedAt,
    ended_at: nowIso(),
  })

  return result
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
