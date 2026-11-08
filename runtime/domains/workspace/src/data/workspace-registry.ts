/**
 * Which working trees on this machine have ever run the factory.
 *
 * An observer watching several trees has to learn they exist. It cannot
 * discover them from git alone: a worktree created this morning holds no
 * trace until something runs in it, and listing every worktree a developer
 * owns would offer trees that have nothing to do with this tool.
 *
 * So a run registers its own tree, on the way up. That timing is the whole
 * point — the FIRST run in a new tree is the one most worth watching, and it
 * is also the one that happens before anybody opens the UI.
 *
 * A file rather than a call to the server, for the same reason. An HTTP
 * registration needs the server already running, on a port the run would have
 * to guess, holding a token; a run started before the UI is open would
 * register nowhere. A file works whether or not anything is watching, and is
 * read by whatever opens later.
 *
 * Append-only JSONL, like the inbox: an append of one short line is atomic
 * enough that two runs starting together cannot interleave into a corrupt
 * record, where a read-modify-write of a JSON document would lose one of
 * them. Repeats are expected and collapse on read.
 */

import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { TEnv } from '../../../../lib/system'
import {
  appendText,
  ensureParentDir,
  fileExists,
  nowIso,
  readText,
  writeText,
} from '../../../../lib/system'
/** One tree, as recorded when a run started in it. */
export type TRegisteredWorkspace = Readonly<{
  /** The working tree itself — what a developer recognises. */
  root: string
  /** Its trace database, which is what an observer actually opens. */
  db: string
  /** When a run last registered it. Triage only; nothing branches on it. */
  at: string
}>

export const REGISTRY_FILENAME = 'workspaces.jsonl'

/**
 * Machine-local, deliberately outside every repository.
 *
 * It is a list of places on this machine, so it belongs to the machine. In a
 * repository it would be committed, shared with people whose paths differ,
 * and wrong for all of them.
 */
export const registryPath = (env: TEnv = process.env): string => {
  const override = (env.CRUST_REGISTRY ?? '').trim()
  return override === ''
    ? join(env.HOME ?? homedir(), '.pi-crust', REGISTRY_FILENAME)
    : resolve(override)
}

/**
 * Record this tree, if the record would say anything new.
 *
 * Re-registering an unchanged tree on every run would grow the file without
 * bound for no information, so an entry whose database is already the newest
 * record for that path is left alone. The timestamp moving is not worth a
 * line; the tree existing is.
 */
export const registerWorkspace = (
  root: string,
  dbPath: string,
  env: TEnv = process.env,
): string => {
  const path = registryPath(env)
  const db = resolve(dbPath)
  const already = readRegistry(path).some((entry) => entry.db === db)
  if (already) return path
  ensureParentDir(path)
  const entry: TRegisteredWorkspace = { root: resolve(root), db, at: nowIso() }
  appendText(path, `${JSON.stringify(entry)}\n`)
  return path
}

/**
 * Every registered tree, newest record per database, in first-seen order.
 *
 * Tolerates a half-written line for the same reason the inbox does: a reader
 * can catch a writer mid-append, and the line will be whole next time.
 */
export const readRegistry = (
  path: string = registryPath(),
): readonly TRegisteredWorkspace[] => {
  if (!fileExists(path)) return []
  const seen = new Map<string, TRegisteredWorkspace>()
  for (const line of readText(path).split('\n')) {
    const entry = parseLine(line)
    if (entry !== undefined) seen.set(entry.db, entry)
  }
  return [...seen.values()]
}

const parseLine = (line: string): TRegisteredWorkspace | undefined => {
  if (line.trim() === '') return undefined
  // biome-ignore lint/plugin: this layer owns the boundary
  try {
    const parsed: unknown = JSON.parse(line)
    if (parsed === null || typeof parsed !== 'object') return undefined
    const entry = parsed as Partial<TRegisteredWorkspace>
    if (typeof entry.db !== 'string' || entry.db === '') return undefined
    return {
      root: typeof entry.root === 'string' ? entry.root : dirname(entry.db),
      db: entry.db,
      at: typeof entry.at === 'string' ? entry.at : '',
    }
  } catch (cause) {
    // A line still being written, or one a future version wrote in a shape
    // this one cannot read. Neither is worth refusing to start over.
    void cause
    return undefined
  }
}

/**
 * Drop trees, by root or by database path. Returns what remains.
 *
 * Deliberately explicit, never automatic. A tree whose database cannot be
 * opened right now looks exactly like one on an unmounted volume or one that
 * has been moved, and silently forgetting a tree that still exists is worse
 * than listing one that says it is unavailable.
 */
export const forgetWorkspaces = (
  paths: readonly string[],
  path: string = registryPath(),
): readonly TRegisteredWorkspace[] => {
  const targets = new Set(paths.map((entry) => resolve(entry)))
  const kept = readRegistry(path).filter(
    (entry) => !(targets.has(entry.root) || targets.has(entry.db)),
  )
  writeRegistry(kept, path)
  return kept
}

/** Rewrite the file from a known set — the one non-append write. */
export const writeRegistry = (
  entries: readonly TRegisteredWorkspace[],
  path: string = registryPath(),
): void => {
  const body = entries.map((entry) => JSON.stringify(entry)).join('\n')
  writeText(path, body === '' ? '' : `${body}\n`)
}
