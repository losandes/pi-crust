/**
 * Several working trees, read as one.
 *
 * Each tree keeps its own database; this holds the open connections and
 * merges what they say. Nothing here writes, and nothing here assumes the
 * trees agree about anything — they are independent repositories that happen
 * to be watched together.
 *
 * Two failure modes are normal rather than exceptional, and both are reported
 * instead of thrown:
 *
 * - a tree with no database yet, because nothing has run in it. It becomes
 *   available the moment something does, so opening is retried rather than
 *   decided once at startup.
 * - a tree that has been removed while the server runs. Its runs disappear
 *   from the list; the other trees keep working.
 */
import { existsSync } from 'node:fs'
import type { SessionSummary } from '../shared/types.ts'
import { PiCrustDb } from './db.ts'
import type { TWorkspace } from './workspaces.ts'

/** A watched tree and whatever is currently known about reaching it. */
export type TWorkspaceState = Readonly<{
  label: string
  root: string
  dbPath: string
  db: PiCrustDb | undefined
  error: string | undefined
}>

export class WorkspaceRegistry {
  private order: readonly TWorkspace[]
  private readonly open = new Map<string, PiCrustDb>()
  private readonly failures = new Map<string, string>()
  /**
   * How the watched set is recomputed, and the stamp that says when to.
   *
   * Without this, adding a worktree would mean restarting the server — and
   * the moment a developer adds one is the moment they are busiest, which is
   * the worst possible time to ask them to restart the thing they are
   * watching. The factory registers a tree as its first run starts, so
   * re-reading on change makes the tree appear within one poll.
   *
   * Gated on a stamp rather than re-resolving per request: resolution shells
   * out to git when sweeping is on, and doing that twice a second per client
   * would be a real cost for a file that changes a few times a week.
   */
  private readonly rescan: (() => readonly TWorkspace[]) | undefined
  private readonly stamp: (() => number) | undefined
  private lastStamp: number

  constructor(
    workspaces: readonly TWorkspace[],
    live?: Readonly<{
      rescan: () => readonly TWorkspace[]
      stamp: () => number
    }>,
  ) {
    this.order = workspaces
    this.rescan = live?.rescan
    this.stamp = live?.stamp
    this.lastStamp = live?.stamp() ?? 0
  }

  /** Re-resolve when the registry file has changed since we last looked. */
  private refresh(): void {
    if (this.rescan === undefined || this.stamp === undefined) return
    const now = this.stamp()
    if (now === this.lastStamp) return
    this.lastStamp = now
    this.order = this.rescan()
  }

  /**
   * The connection for one workspace, opened on first use and kept.
   *
   * Retried on every miss, deliberately. A worktree created this morning has
   * no database until its first run, and a registry that decided at startup
   * would keep reporting it empty for the rest of the day.
   */
  private connect(workspace: TWorkspace): PiCrustDb | undefined {
    const existing = this.open.get(workspace.label)
    if (existing) {
      // A tree can vanish — a worktree removed, a store relocated — after we
      // opened it. bun:sqlite keeps serving reads against a deleted file's
      // inode until the fd closes, so the only reliable signal is checking
      // the path still names something, not waiting for a query to throw.
      if (existsSync(existing.path)) return existing
      existing.close()
      this.open.delete(workspace.label)
      this.failures.set(workspace.label, 'workspace is gone')
      return undefined
    }
    // This IS the boundary: PiCrustDb's constructor throws on a missing or
    // unreadable file, and this registry's whole contract is reporting that
    // as a per-workspace failure instead of taking the server down with it.
    // biome-ignore lint/plugin/no-intermediate-try-catch: converting a thrown open failure into the failures map is this method's job
    try {
      const db = new PiCrustDb(workspace.dbPath, workspace.label)
      this.open.set(workspace.label, db)
      this.failures.delete(workspace.label)
      return db
    } catch (error) {
      this.failures.set(
        workspace.label,
        error instanceof Error
          ? (error.message.split('\n')[0] ?? 'unreadable')
          : 'unreadable',
      )
      return undefined
    }
  }

  /** Every watched tree, in the order it was given, reachable or not. */
  states(): readonly TWorkspaceState[] {
    this.refresh()
    return this.order.map((workspace) => {
      const db = this.connect(workspace)
      return {
        label: workspace.label,
        root: workspace.root,
        dbPath: workspace.dbPath,
        db,
        error:
          db === undefined ? this.failures.get(workspace.label) : undefined,
      }
    })
  }

  /** Only the trees that can currently be read. */
  private live(): readonly PiCrustDb[] {
    return this.states()
      .map((state) => state.db)
      .filter((db): db is PiCrustDb => db !== undefined)
  }

  /** The one workspace a label names, or nothing when it names none. */
  byLabel(label: string): PiCrustDb | undefined {
    this.refresh()
    const match = this.order.find((workspace) => workspace.label === label)
    return match === undefined ? undefined : this.connect(match)
  }

  /**
   * The workspace holding a run, for a request that gives only the run id.
   *
   * Every link minted from now on carries its workspace, so this is the path
   * for links that predate it and for anything a developer typed. Run ids are
   * generated per tree, so two trees could in principle mint the same one;
   * first match wins, which is the only answer available and is why new links
   * are addressed by both.
   */
  owning(runId: string): PiCrustDb | undefined {
    return this.live().find((db) => db.session(runId) !== null)
  }

  /**
   * One workspace when named, otherwise whichever holds the run.
   *
   * The single place that resolves a request to a database, so a route can
   * take `?workspace=` without each one re-deciding what an absent value
   * means.
   */
  resolve(runId: string, label: string | undefined): PiCrustDb | undefined {
    if (label === undefined || label === '') return this.owning(runId)
    const named = this.byLabel(label)
    // A named workspace that does not hold the run is an error, not a reason
    // to go looking elsewhere: it means the link is wrong, and silently
    // answering from another tree would hide that.
    return named?.session(runId) === null ? undefined : named
  }

  /**
   * Sessions from every reachable tree, newest first.
   *
   * The limit applies to the merged list, not to each tree, so five busy
   * worktrees cannot push a sixth tree's only run off the end by weight of
   * numbers alone — each contributes its own newest `limit` and the merge
   * keeps the newest overall.
   */
  sessions(limit = 200, includeArchived = false): readonly SessionSummary[] {
    return this.live()
      .flatMap((db) => db.sessions(limit, includeArchived))
      .toSorted(compareStarted)
      .slice(0, limit)
  }

  /** Total across reachable trees, for the health line. */
  sessionCount(): number {
    return this.live().reduce((total, db) => total + db.sessionCount(), 0)
  }

  close(): void {
    for (const db of this.open.values()) db.close()
    this.open.clear()
  }
}

/**
 * Newest first, with a stable tie-break.
 *
 * Timestamps are ISO strings written by independent processes, so two runs
 * started in the same second are genuinely tied; falling back to the run id
 * keeps the order from shuffling between polls, which would make rows jump
 * under the cursor.
 */
const compareStarted = (
  left: SessionSummary,
  right: SessionSummary,
): number => {
  const byTime = (right.started_at ?? '').localeCompare(left.started_at ?? '')
  return byTime === 0 ? left.run_id.localeCompare(right.run_id) : byTime
}
