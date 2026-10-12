/**
 * Whether a Stage that claims concurrency can actually have it.
 *
 * `strategy: concurrent` says two Activities may run against the same working
 * tree at the same time. That is only true when they do not write the same
 * thing, and the system cannot find out afterwards: permission is enforced by
 * comparing the tree before and after an Activity, which under concurrency
 * attributes every change to both of them.
 *
 * So the claim is checked before the run, from what the Activities declare.
 * Two Activities whose paths can overlap are refused with both names and the
 * patterns that collide, because "this stage cannot be concurrent" without
 * saying which pair is an invitation to delete the wrong line.
 *
 * Overlap is decided by pattern, not by what the Activities will actually
 * write. `**\/*.md` and `docs/guide.md` are refused even if the second
 * Activity only ever touches a file the first ignores. A conservative
 * refusal costs a developer one edit; a permissive one costs a race nobody
 * can reproduce.
 */

import type { TActivityConfig } from '../typedefs/activity'
import type {
  TLifecycleConfig,
  TLifecycleFault,
} from '../typedefs/lifecycle'
import { matchesPattern } from './enforce-permissions'

/** A pattern reduced to the literal prefix it cannot match outside of. */
const prefixOf = (pattern: string): string => {
  const wildcard = pattern.search(/[*?[]/)

  return wildcard === -1 ? pattern : pattern.slice(0, wildcard)
}

/**
 * Whether two declared patterns could ever name the same path.
 *
 * `*` is the whole repository and overlaps everything. Otherwise a pattern
 * either matches the other outright — `src/` against `src/a.ts` — or their
 * literal prefixes nest, which is as close as this can get without
 * enumerating a filesystem that does not exist yet.
 */
export const patternsOverlap = (left: string, right: string): boolean => {
  if (left === '*' || right === '*') {
    return true
  }
  if (left === right) {
    return true
  }
  if (matchesPattern(right, left) || matchesPattern(left, right)) {
    return true
  }
  const [a, b] = [prefixOf(left), prefixOf(right)]

  return a !== '' && b !== '' && (a.startsWith(b) || b.startsWith(a))
}

type TNamedWrites = Readonly<{ activity: string; writes: readonly string[] }>

const collisions = (
  lifecycle: string,
  stage: string,
  members: readonly TNamedWrites[],
): readonly TLifecycleFault[] =>
  members.flatMap((left, at) =>
    members.slice(at + 1).flatMap((right) => {
      /*
       * One fault per pair, not per colliding pattern. An Activity that may
       * write anywhere collides with every line the other declared, and
       * reporting each of them buries the one fact the developer needs:
       * these two cannot share a stage. The first collision is named as the
       * evidence.
       */
      const hit = left.writes.flatMap((lp) =>
        right.writes.filter((rp) => patternsOverlap(lp, rp)).map((rp) => [lp, rp]),
      )[0]
      if (hit === undefined) {
        return []
      }
      const [lp, rp] = hit

      return [
        {
          lifecycle,
          message:
            `stage '${stage}' runs '${left.activity}' and ` +
            `'${right.activity}' concurrently, but both may write ` +
            `${lp === rp ? lp : `${lp} and ${rp}`} — one would be ` +
            'overwriting the other, and neither could be held responsible',
        },
      ]
    }),
  )

/**
 * Every concurrency claim a Lifecycle makes that its Activities do not support.
 *
 * An Activity a Lifecycle names and the registry does not have is somebody
 * else's fault to report; it is skipped here rather than reported twice.
 */
export const concurrencyFaults = (
  lifecycle: TLifecycleConfig,
  activities: readonly TActivityConfig[],
): readonly TLifecycleFault[] =>
  lifecycle.stages
    .filter((stage) => stage.strategy === 'concurrent')
    .flatMap((stage) =>
      collisions(
        lifecycle.name,
        stage.name,
        stage.activities.flatMap((name) => {
          /*
           * The Activity's own declaration, with no performer to look up:
           * an Activity IS an agent, so "what may this write" is a question
           * about the entry a Lifecycle named rather than about a second
           * registry that had to agree with it.
           */
          const activity = activities.find((one) => one.name === name)

          return activity === undefined
            ? []
            : [{ activity: name, writes: activity.writes ?? ['*'] }]
        }),
      ),
    )
