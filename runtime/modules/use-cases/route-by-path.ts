/**
 * Routing by changed path: which skills an agent loads, which checks run.
 *
 * Both answers come out of `routing:` in the config and nowhere else. This is
 * what makes the factory portable — a stamped repository declares its own
 * review skill and its own checkers, and no module or prompt in this tree names
 * either one.
 *
 * Glob semantics are the ones `writes:` already uses (`enforce-permissions`):
 * `*` stops at a path separator and `**` crosses it, so a double-star pattern
 * is what reaches a nested file, where `*.ts` matches only the repository root.
 * An empty `when` list always matches; an empty path list matches nothing but
 * an empty `when`.
 */

import type {
  TPiCrustConfig,
  TRoutingCheck,
  TRoutingSkill,
} from '../typedefs/config'
import type { TQualityCheckSpec } from '../typedefs/quality'
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

/** `revise_2` -> `revise`: an instance suffix is numbering, not a new activityRun. */
export const baseActivityRunName = (name: string): string =>
  name.replace(/_\d+$/, '')

/**
 * Skill paths this agent should load for this change, in declared order.
 *
 * `activityRun` narrows a skill to the activity runs it is about — a skill on how to answer
 * a review belongs to a revise and nowhere else. Omitted, and for any skill
 * declaring no `activityRuns`, the behaviour is exactly what it was.
 */
export const matchingSkills = (
  cfg: TPiCrustConfig,
  agentName: string,
  paths: readonly string[],
  activityRun = '',
): readonly string[] =>
  cfg.routing.skills
    .filter(
      (skill: TRoutingSkill) =>
        (skill.agents.length === 0 || skill.agents.includes(agentName)) &&
        (skill.activity_runs.length === 0 ||
          skill.activity_runs.includes(baseActivityRunName(activityRun))) &&
        applies(paths, skill.when),
    )
    .map((skill) => skill.path)

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
  area: check.area,
  operation: check.operation,
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
