/**
 * What a step actually wrote, as opposed to what it says it wrote.
 *
 * `artifacts` on an envelope is self-reported. It is usually right, and it is
 * the only way to learn about a file written outside the handoff directory —
 * but nothing checks it, so on its own it can claim a file that was never
 * written, miss one that was, and say nothing at all about a file the system
 * wrote rather than an agent.
 *
 * Observation closes that. Snapshot the handoff directory either side of a
 * activityRun and the difference is evidence: this activityRun created this file, that
 * one changed a file another activityRun owns.
 *
 * Content-addressed rather than a directory listing, because the case worth
 * catching is the one a listing cannot see. A step that rewrites `design.md`
 * leaves the name and often the size intact; only the bytes say it happened.
 * These are markdown documents of a few kilobytes, so hashing them costs
 * nothing worth measuring.
 */

import { createHash } from 'node:crypto'
import { chmodSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ensureParentDir, fileExists } from './files'

/** Relative path within the handoff directory, to the hash of its contents. */
export type THandoffSnapshot = ReadonlyMap<string, string>

/** What one activityRun did to the handoff directory while it ran. */
export type THandoffChange = Readonly<{
  /** Files that did not exist before this activityRun. Its own output. */
  created: readonly string[]
  /** Files that existed and now hold different bytes. Someone else's output. */
  modified: readonly string[]
  /** Files that existed and no longer do. */
  deleted: readonly string[]
}>

export const NO_CHANGE: THandoffChange = Object.freeze({
  created: [],
  modified: [],
  deleted: [],
})

const sha = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)

/**
 * Every file under the directory, by relative path, with its content hash.
 *
 * Recursive, because an agent told to write "a document" may well make a
 * folder for it, and a snapshot that only saw the top level would report the
 * whole subtree as nothing at all.
 *
 * An unreadable entry is skipped rather than thrown: this is observation, and
 * failing an activity run because a file vanished between the listing and the read
 * would turn a diagnostic into an outage.
 */
export const snapshotHandoff = (dir: string): THandoffSnapshot => {
  const found = new Map<string, string>()
  if (!fileExists(dir)) return found
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      // biome-ignore lint/plugin: observation must not fail the activityRun it watches
      try {
        if (entry.isDirectory()) walk(full)
        else if (entry.isFile()) found.set(relative(dir, full), sha(full))
      } catch (cause) {
        void cause
      }
    }
  }
  // biome-ignore lint/plugin: a directory that disappeared is an empty snapshot
  try {
    walk(dir)
  } catch (cause) {
    void cause
  }
  return found
}

/** The difference between two snapshots, in the three terms that matter. */
export const diffHandoff = (
  before: THandoffSnapshot,
  after: THandoffSnapshot,
): THandoffChange => ({
  created: [...after.keys()].filter((path) => !before.has(path)).toSorted(),
  modified: [...after.keys()]
    .filter((path) => before.has(path) && before.get(path) !== after.get(path))
    .toSorted(),
  deleted: [...before.keys()].filter((path) => !after.has(path)).toSorted(),
})

/** Whether anything happened at all, so an idle activityRun records nothing. */
export const changed = (change: THandoffChange): boolean =>
  change.created.length + change.modified.length + change.deleted.length > 0

/**
 * Copies of what exists now, so damage can be undone.
 *
 * Taken before an activity run runs, because git cannot help here: the session
 * directory is ignored, which is exactly why an agent is allowed to write in
 * it and exactly why nothing would notice when it writes over someone else's
 * work.
 */
/**
 * Put copies back over what a step changed or removed. Returns what it fixed.
 *
 * The file may be locked, which is the normal case — it was locked precisely
 * because it belonged to an earlier step — so the mode is lifted for the
 * write and the caller locks it again. A path with no copy is one that did
 * not exist before this step, so there is nothing to restore and nothing
 * wrong.
 */
export const restoreAll = (
  dir: string,
  originals: ReadonlyMap<string, Buffer>,
  paths: readonly string[],
): readonly string[] =>
  paths.filter((path) => {
    const original = originals.get(path)
    if (original === undefined) return false
    // biome-ignore lint/plugin: a repair that cannot be made is reported, not thrown
    try {
      const full = join(dir, path)
      ensureParentDir(full)
      chmodSync(full, 0o644)
      writeFileSync(full, original)
      return true
    } catch (cause) {
      void cause
      return false
    }
  })

export const readAll = (
  dir: string,
  paths: readonly string[],
): ReadonlyMap<string, Buffer> => {
  const copies = new Map<string, Buffer>()
  for (const path of paths) {
    // biome-ignore lint/plugin: a file that cannot be copied simply is not one
    try {
      const full = join(dir, path)
      if (statSync(full).isFile()) copies.set(path, readFileSync(full))
    } catch (cause) {
      void cause
    }
  }
  return copies
}
