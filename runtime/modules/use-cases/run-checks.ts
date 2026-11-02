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
import { matchingChecks, unmatchedPaths } from './route-by-path'

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
  params: Readonly<{
    repoRoot: string
    outputArtifact: string
    note?: (line: string) => void
  }>,
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

/** Said in one place, because the gate and `just crust verify` both say it. */
export const NOTHING_DECLARED =
  'no checks are declared: routing.checks in crust.config.yaml is empty, so ' +
  'there is nothing to run. Declare a rule there to have changes verified.'

export const NOTHING_MATCHED = (paths: number): string =>
  `${paths} path(s) changed but no routing.checks matched them — add a rule ` +
  'to routing.checks in crust.config.yaml, or narrow the change. Nothing ' +
  'was verified.'

/**
 * The checks the CHANGED PATHS select — the deterministic half of verification.
 *
 * Four outcomes, and the two middle ones are the reason this function exists:
 *
 *   | routing.checks | changed paths | matched | verdict                       |
 *   |----------------|---------------|---------|-------------------------------|
 *   | empty          | —             | —       | passed: nothing was promised  |
 *   | declared       | none          | —       | passed: nothing changed       |
 *   | declared       | some          | 0       | passed: gap is named, not failed (1.1.1) |
 *   | declared       | some          | N       | the real verdict              |
 *
 * The first row is a correction. An empty registry used to fail every
 * `checks` gate, which made the SHIPPED configuration unrunnable: `checks:
 * []` is what an install stamps, the config file that holds it is in
 * `protected_files`, and so a build agent met a gate it could not pass and
 * could not fix. A factory whose first run cannot go green teaches nobody
 * anything about verification.
 *
 * The third row is the second correction (issue #2). Declaring nothing and
 * declaring a rule that does not match are different claims — nothing
 * declared is a repository that has not opted in, a rule that matched
 * nothing is one that opted in and left this change uncovered — but neither
 * is a FAILURE under the default policy: a repository that fails its own
 * build the first time a change lands outside its rules learns nothing from
 * that failure except to stop trusting the gate. The gap still rides back as
 * `unmatchedPaths`, so zero checks run is never reported identically to zero
 * checks failing. `routing.unmatched: "block"` (1.3.1) restores the old,
 * failing behaviour for a repository that wants it.
 */
export const runVerification = (
  run: TRun,
  changedPaths: readonly string[],
): TQualityResult => {
  if (run.cfg.routing.checks.length === 0 || changedPaths.length === 0) {
    return {
      passed: true,
      checks: [],
      failures: [],
      artifacts: [],
      unmatchedPaths: [],
    }
  }
  const specs = matchingChecks(run.cfg, changedPaths)
  const gaps = unmatchedPaths(run.cfg, changedPaths)
  const checks = specs.map((spec) => runCheck(spec, run))
  const blocked = run.cfg.routing.unmatched === 'block' && gaps.length > 0
  return {
    passed: checks.every((check) => check.passed) && !blocked,
    checks,
    failures: [
      ...checks.filter((check) => !check.passed).map(failureOf),
      ...(blocked ? [NOTHING_MATCHED(gaps.length)] : []),
    ],
    artifacts: checks.map((check) => check.outputArtifact),
    unmatchedPaths: gaps,
  }
}
