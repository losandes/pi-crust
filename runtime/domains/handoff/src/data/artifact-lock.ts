/**
 * A finished activity's document, made read-only so the next activity cannot take it.
 *
 * Every agent is granted the whole session directory, deliberately: an agent
 * that is read-only with respect to the repository must still be able to
 * record its own work. The cost of that grant is that nothing stops a later
 * activity overwriting `design.md` with its own, and because the directory is
 * gitignored, the permission check never sees it and git cannot restore it.
 *
 * The file mode closes the common case at the moment it happens. A locked
 * file refuses both paths an agent has — the write tool and a shell redirect
 * — with the activity seeing an error it can report rather than silently
 * producing a run whose design is not the one that was approved.
 *
 * It is a guardrail, not a boundary. The agent runs as the owner of these
 * files and could change the mode back; and a lock does not prevent DELETION,
 * because unlinking is governed by the directory's permission rather than the
 * file's. Deletion stays the business of the observation that follows a activity.
 */

import { chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** Owner-readable only: no write, for anyone. */
const LOCKED = 0o444

/** Owner-writable again, for the activity that owns the file. */
const UNLOCKED = 0o644

/**
 * Files the FACTORY writes and rewrites, which must never be locked.
 *
 * The gate rewrites its question every time a run stops, the answer arrives
 * from a person, the dispute ledger is amended across rounds, and the diff is
 * recaptured on each build. Locking any of them would not protect a activity's
 * work; it would break the machinery that was about to write them again.
 */
const MACHINERY = new Set([
  'decision-request.md',
  'decision-answer.md',
  'decision-answer.json',
  'disputes.md',
  'disputes.json',
  'changes.diff',
  // Appended to every time a person sends the run back. Locked, a second
  // steer would be refused by the mode the first one's activityRun set.
  'steering.md',
])

/** Whether this path is a activity's own output rather than the run's plumbing. */
export const isStepDocument = (path: string): boolean => {
  const name = path.split('/').at(-1) ?? path
  return !(MACHINERY.has(name) || name.startsWith('answers-'))
}

const setMode = (
  dir: string,
  paths: readonly string[],
  mode: number,
): readonly string[] =>
  paths.filter((path) => {
    if (!isStepDocument(path)) return false
    const full = join(dir, path)
    if (!existsSync(full)) return false
    // biome-ignore lint/plugin: a mode that cannot be set is not worth a failed run
    try {
      chmodSync(full, mode)
      return true
    } catch (cause) {
      void cause
      return false
    }
  })

/** Make these documents read-only. Returns the ones actually locked. */
export const lockArtifacts = (
  dir: string,
  paths: readonly string[],
): readonly string[] => setMode(dir, paths, LOCKED)

/**
 * Make these documents writable again, for a activity about to replace them.
 *
 * A activity that runs a second time — a retry, or a rejection sending it back —
 * legitimately replaces its OWN output, and that is the one overwrite that
 * must be allowed. Everything another activity produced stays locked.
 */
export const unlockArtifacts = (
  dir: string,
  paths: readonly string[],
): readonly string[] => setMode(dir, paths, UNLOCKED)
