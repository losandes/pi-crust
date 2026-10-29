/**
 * Choosing which runs to forget.
 *
 * A trace is cheap and a session directory is not: twelve megabytes for eight
 * trivial scouts, and a real lifecycle writes the whole of every agent's
 * stream. Left alone this grows until somebody deletes the lot in a panic,
 * which is how the one run worth keeping gets lost.
 *
 * The SELECTION is here and is pure, because deleting the wrong run is
 * unrecoverable and a decision that destructive should be inspectable without
 * a filesystem. The deleting itself lives in the script.
 *
 * Two rules protect you from the obvious mistakes:
 *
 *   - a run that is still RUNNING or WAITING is never pruned, whatever its
 *     age — a waiting run is old precisely because it is waiting for you
 *   - nothing is deleted without an explicit age, so a bare `prune` cannot
 *     mean "everything"
 */

/** An ISO timestamp as milliseconds, or NaN when it is not one. */
const ts = (iso: string | null | undefined): number =>
  iso ? new Date(iso).getTime() : Number.NaN

export type TPrunable = Readonly<{
  run_id: string
  status: string
  started_at: string | null | undefined
}>

/**
 * The distinct working trees a set of sessions names (1.8.1), from the
 * trace's own `workspace_root` column "this becomes the only way to tell
 * whose run a row is once a store holds several trees" (1.4.3).
 */
export const workspacesIn = (
  runs: readonly Readonly<{ workspace_root: string | null | undefined }>[],
): readonly string[] => {
  const found = new Set<string>()
  for (const run of runs) {
    if (run.workspace_root) found.add(run.workspace_root)
  }
  return [...found].toSorted()
}

export type TPruneVerdict = Readonly<{
  /** runs to delete, oldest first */
  doomed: readonly string[]
  /** runs kept because they are not finished, with why */
  spared: readonly Readonly<{ run_id: string; because: string }>[]
}>

const DAY_MS = 86_400_000

/** `14d`, `36h`, `90` (days) → milliseconds, or undefined when unreadable. */
export const parseAge = (value: string | undefined): number | undefined => {
  const text = (value ?? '').trim().toLowerCase()
  const match = /^(\d+)\s*([dh]?)$/.exec(text)
  if (match === null) return undefined
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return undefined
  return match[2] === 'h' ? amount * 3_600_000 : amount * DAY_MS
}

/**
 * Which runs are old enough to forget, and which are not going anywhere.
 *
 * A run with no start time is treated as un-prunable rather than as
 * infinitely old: a missing timestamp is a damaged row, and the safe reading
 * of damage is "leave it alone".
 */
/** Why a run is being kept, or undefined when it is not being kept. */
const sparedBecause = (
  run: TPrunable,
  olderThanMs: number,
  nowMs: number,
): string | undefined => {
  if (run.status === 'running' || run.status === 'waiting') {
    return `still ${run.status} — a waiting run is old because it is waiting for you`
  }
  const started = ts(run.started_at)
  if (!Number.isFinite(started)) return 'no start time recorded'
  return nowMs - started >= olderThanMs ? undefined : 'not old enough'
}

/**
 * Which runs are old enough to forget, and which are not going anywhere.
 *
 * A run with no start time is treated as un-prunable rather than as
 * infinitely old: a missing timestamp is a damaged row, and the safe reading
 * of damage is "leave it alone".
 *
 * Partitioned in one pass rather than folded with spreads — this list is
 * every run a repository has ever done, and rebuilding both arrays per run
 * makes a routine cleanup quadratic in the thing it is cleaning up.
 */
export const pruneVerdict = (
  runs: readonly TPrunable[],
  olderThanMs: number,
  nowMs: number,
): TPruneVerdict => {
  const judged = runs.map((run) => ({
    run,
    because: sparedBecause(run, olderThanMs, nowMs),
  }))
  return {
    doomed: judged
      .filter((entry) => entry.because === undefined)
      .map((entry) => entry.run.run_id),
    spared: judged
      .filter(
        (entry) =>
          entry.because !== undefined && entry.because !== 'not old enough',
      )
      .map((entry) => ({
        run_id: entry.run.run_id,
        because: entry.because ?? '',
      })),
  }
}
