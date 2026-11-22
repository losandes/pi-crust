/**
 * Routing by changed path: which checks run.
 *
 * A stamped repository declares its own checkers in `routing:`; no module or
 * prompt in this tree names them.
 *
 * Glob semantics are the ones `writes:` already uses (`enforce-permissions`):
 * `*` stops at a path separator and `**` crosses it, so a double-star pattern
 * is what reaches a nested file, where `*.ts` matches only the repository root.
 * An empty `when` list always matches; an empty path list matches nothing but
 * an empty `when`.
 */

import type {
  TPiCrustConfig,
  TQualityCheckSpec,
  TRoutingCheck,
} from '../../../../lib/contracts'
import { matchesPattern } from './enforce-permissions'

/** The subset of `paths` this rule's globs select. Empty `when` takes all. */
export const matchingPaths = (
  paths: readonly string[],
  patterns: readonly string[],
): readonly string[] =>
  patterns.length === 0
    ? [...paths]
    : paths.filter((path) =>
        patterns.some((pattern) => matchesPattern(path, pattern)),
      )

const applies = (
  paths: readonly string[],
  patterns: readonly string[],
): boolean => patterns.length === 0 || matchingPaths(paths, patterns).length > 0

/**
 * A changed path, spelled from the directory the command will run in.
 *
 * Changed paths are collected from the git root; a check may run somewhere
 * below it. Handing a root-relative path to a command running in a
 * subdirectory produces a file that does not exist, and the tool reports it as
 * a missing file rather than as a misconfiguration.
 */
export const rebase = (path: string, cwd: string): string => {
  const base = cwd.replace(/\/+$/, '')
  return base === '' || !path.startsWith(`${base}/`)
    ? path
    : path.slice(base.length + 1)
}

/** One routing check, resolved into the spec the quality runner executes. */
export const checkSpec = (
  check: TRoutingCheck,
  paths: readonly string[],
): TQualityCheckSpec => ({
  name: check.name,
  argv: check.with_changed_paths
    ? [
        ...check.argv,
        ...matchingPaths(paths, check.when).map((path) =>
          rebase(path, check.cwd),
        ),
      ]
    : [...check.argv],
  timeoutSeconds: check.timeout_seconds,
  cwd: check.cwd,
})

/** The checks these changed paths select, already resolved to specs. */
export const matchingChecks = (
  cfg: TPiCrustConfig,
  paths: readonly string[],
): readonly TQualityCheckSpec[] =>
  cfg.routing.checks
    .filter((check) => applies(paths, check.when))
    .map((check) => checkSpec(check, paths))

/**
 * The changed paths no declared `routing.checks` rule reaches.
 *
 * A path is covered the moment ONE rule's `when` selects it — which rule, or
 * how many, is not this question's business. An empty `when` always matches,
 * same as `applies` above.
 */
export const unmatchedPaths = (
  cfg: TPiCrustConfig,
  paths: readonly string[],
): readonly string[] =>
  paths.filter(
    (path) => !cfg.routing.checks.some((check) => applies([path], check.when)),
  )
