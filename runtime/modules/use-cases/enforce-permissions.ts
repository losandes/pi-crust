/**
 * What an agent may CHANGE, enforced in code after the fact.
 *
 * `tools:` is a capability list, not a sandbox, and two holes make it
 * unenforceable on its own:
 *
 *   * `bash` runs anything. A builder handed bash to run a test suite can also
 *     run `git checkout .pi-crust/` — which is not hypothetical: one did, discarding
 *     uncommitted changes to the very quality check it was about to be judged by.
 *   * `write` reaches any path, not just the one report file an agent was given
 *     it for. A reviewer configured with "no edit, so it cannot quietly fix"
 *     could still rewrite the code it was reviewing.
 *
 * So permission is verified the way every other claim in this system is — after
 * the fact, against the repo itself. `snapshotTree()` fingerprints the working
 * tree's change-set before an agent runs; `enforcePermissions()` compares it
 * afterwards and fails the activityRun if the agent touched anything outside its
 * allowlist.
 *
 * Comparing change-sets, rather than watching for writes, is what catches the
 * `git checkout` case: a path that was modified before the agent ran and is
 * clean afterwards has been reverted, and a reversion is a modification.
 * Appearing, disappearing, and changing all count.
 *
 * A breach is NOT a gate violation. Gates are for work an agent can be asked to
 * redo; a breach cannot be corrected by re-prompting, because the write already
 * happened. It aborts the activityRun and names every offending path.
 *
 * Two keys drive it, both in crust.config.yaml:
 *     defaults.protected_files   paths no agent may touch unless it names them
 *     agents[].writes   ['*'] = unrestricted · [] = read-only · [...] = only these
 */

import { resolve } from 'node:path'
import { checkoutPath, isRepo, rev } from '../data/git'
import type { TTreeSnapshot } from '../data/working-tree'
import { deletePath, snapshotTree } from '../data/working-tree'
import type { TAgentConfig, TPiCrustConfig } from '../typedefs/config'
import type { TRun } from '../typedefs/run'

/** An agent modified a path it was not permitted to modify. */
export class PermissionBreach extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PermissionBreach'
  }
}

/** Every path whose state differs — appeared, vanished, or was rewritten. */
export const changedPaths = (
  before: TTreeSnapshot,
  after: TTreeSnapshot,
): readonly string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((path) => before[path] !== after[path])
    .toSorted()

/**
 * Translate a pattern, with `*` stopping at a path separator.
 *
 * A plain glob would let `*` cross `/`, which quietly widens every pattern:
 * `.pi-crust/stages/*.ts` would match `.pi-crust/data/sessions/x/y.ts` as well as the
 * workflow scripts it means. `**` is the way to say "cross directories".
 */
export const globToRegExp = (pattern: string): RegExp => {
  const translate = (index: number): readonly string[] => {
    if (index >= pattern.length) {
      return []
    }
    if (pattern.startsWith('**', index)) {
      return ['.*', ...translate(index + 2)]
    }
    const char = pattern[index] ?? ''
    const piece =
      char === '*'
        ? '[^/]*'
        : char === '?'
          ? '[^/]'
          : char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return [piece, ...translate(index + 1)]
  }
  const parts = translate(0)
  return new RegExp(`^${parts.join('')}$`)
}

export const matchesPattern = (path: string, pattern: string): boolean => {
  if (pattern.endsWith('/')) {
    // directory prefix
    return path.startsWith(pattern)
  }
  if (pattern.includes('*') || pattern.includes('?')) {
    return globToRegExp(pattern).test(path)
  }
  return path === pattern
}

/**
 * The session runtime, which EVERY agent must be able to write.
 *
 * `context_handoff/` is the one place agents hand work to each other, and an
 * agent's own prompts, raw_output.jsonl, and envelope.json land beside it.
 * Scout writes its findings there, the reviewer its review, the planner its
 * plan — a read-only agent is read-only with respect to the REPO, never with
 * respect to its own report.
 *
 * This is granted from `data_dir` rather than left to .gitignore. The runtime
 * is normally ignored, so it never even appears in a snapshot — but an agent's
 * ability to record its work must not hang on a gitignore entry that someone
 * can delete or that a changed `data_dir` can outgrow.
 */
export const alwaysWritable = (cfg: TPiCrustConfig): readonly string[] => [
  `${cfg.defaults.data_dir.replace(/\/+$/, '')}/`,
]

/**
 * The token a `writes` entry uses for this run's handoff directory.
 *
 * The directory is named after the run, so no configuration file can write
 * its path literally. The token is what lets an Activity declare the document
 * it produces anyway — and declaring it is what makes "these two Activities
 * do not write the same thing" a question a check can answer.
 */
export const HANDOFF_TOKEN = '{handoff}'

/**
 * An agent's declared paths, with `{handoff}` resolved against this run.
 *
 * Repo-relative, because that is what a tree snapshot reports. An absolute
 * handoff directory outside the repository resolves to a path no snapshot
 * will ever contain, which is correct: the agent is free to write there and
 * nothing in the repo changed.
 */
export const resolveWrites = (
  writes: readonly string[],
  repoRoot: string,
  handoffDir: string,
): readonly string[] => {
  const absolute = resolve(handoffDir)
  const root = `${resolve(repoRoot)}/`
  const relative = absolute.startsWith(root)
    ? absolute.slice(root.length)
    : absolute

  return writes.map((pattern) =>
    pattern.startsWith(HANDOFF_TOKEN)
      ? `${relative}${pattern.slice(HANDOFF_TOKEN.length)}`
      : pattern,
  )
}

/**
 * The document an Activity produces, as the agent should be told to write it.
 *
 * The first `{handoff}` entry naming a file. A prompt renders this rather
 * than hardcoding a filename, so redirecting an Activity's output — findings
 * into `specs/` instead of the handoff directory — is a configuration change
 * and not a prompt fork.
 */
export const handoffDocument = (
  writes: readonly string[],
  repoRoot: string,
  handoffDir: string,
): string | undefined => {
  const named = writes.find(
    (pattern) => pattern.startsWith(HANDOFF_TOKEN) && /\.[a-z]+$/.test(pattern),
  )

  return named === undefined
    ? undefined
    : resolveWrites([named], repoRoot, handoffDir)[0]
}

/** Session runtime first, then the agent's own list, then what is protected. */
export const permitted = (
  path: string,
  agent: TAgentConfig,
  cfg: TPiCrustConfig,
  /** `{handoff}` already resolved; defaults to the agent's literal list */
  writes: readonly string[] = agent.writes,
): boolean => {
  if (alwaysWritable(cfg).some((pattern) => matchesPattern(path, pattern))) {
    return true
  }
  // naming a path is what unlocks a protected one
  if (writes.some((pattern) => matchesPattern(path, pattern))) {
    return true
  }
  if (
    cfg.defaults.protected_files.some((pattern) =>
      matchesPattern(path, pattern),
    )
  ) {
    return false
  }

  /*
   * `*` on its own is the only way to say "anywhere", and it is deliberately
   * something a developer has to type. It used to be what an omitted `writes`
   * meant, which made the widest permission the one granted by saying
   * nothing.
   */
  return agent.writes.includes('*')
}

/**
 * Undo one unauthorized change. Returns a word describing what happened.
 *
 * Only changes the agent INTRODUCED are undone. A path that was already dirty
 * when the agent started is left exactly as it is: the operator had uncommitted
 * work there, and discarding it to tidy up would be the same harm this module
 * exists to prevent, committed by the cleanup instead of the agent.
 */
export const rollBack = (
  repoRoot: string,
  path: string,
  before: TTreeSnapshot,
  after: TTreeSnapshot,
): string => {
  if (path in before) {
    // Already dirty beforehand. If it is gone from the diff now, the agent
    // reverted an engineer's uncommitted work and the content is not ours to
    // reconstruct — say so loudly rather than pretend it was handled.
    return path in after
      ? 'left as-is (was already modified)'
      : 'REVERTED-BY-AGENT (uncommitted work lost, cannot restore)'
  }
  if (after[path] === 'untracked') {
    const removed = deletePath(repoRoot, path)
    return removed.deleted ? 'deleted' : `could not delete (${removed.reason})`
  }
  return checkoutPath(path, repoRoot) ? 'rolled back' : 'could not roll back'
}

const scopeOf = (agent: TAgentConfig, cfg: TPiCrustConfig): string => {
  if (agent.writes.includes('*')) {
    return `barred from ${cfg.defaults.protected_files.join(', ')}`
  }
  return agent.writes.length === 0
    ? 'read-only'
    : `limited to ${agent.writes.join(', ')}`
}

/**
 * Compare the tree against `before`; undo and throw if the agent overstepped.
 *
 * Returns the paths it legitimately changed, so the trace records what an agent
 * actually touched rather than only what it claimed in its envelope.
 *
 * Detection alone would leave the repo holding the unauthorized change while
 * reporting a failure, so anything the agent introduced outside its allowlist
 * is rolled back before the activityRun dies. What it cannot undo, it names.
 */
/**
 * Where the repository was before an Activity touched it.
 *
 * The tree AND history, because an agent that commits its own work leaves a
 * clean tree: comparing change-sets alone would report that nothing
 * happened. `committing` is the EFFECTIVE permission, not the declared one —
 * under `--commit false` an Activity that declares `commit: true` is not
 * committing either.
 */
export type TRepoBefore = Readonly<{
  tree: TTreeSnapshot
  /** HEAD before the Activity ran; '' outside a repository */
  head: string
  committing: boolean
}>

/**
 * A commit nobody authorised, reported like any other breach.
 *
 * Not rolled back. Resetting history under a developer is a bigger harm than
 * the commit was, and the commit is recoverable by whoever reads the report.
 */
export const commitBreach = (before: TRepoBefore): readonly string[] => {
  if (before.committing || before.head === '' || !isRepo()) {
    return []
  }
  const head = rev('HEAD')

  return head === before.head
    ? []
    : [
        `HEAD moved from ${before.head.slice(0, 7)} to ${head.slice(0, 7)} — ` +
          'this activity was not committing, and committing is the engine\'s ' +
          'to do. Left in history; undo it yourself if it is wrong.',
      ]
}

export const enforcePermissions = (
  run: TRun,
  agent: TAgentConfig,
  repoBefore: TRepoBefore,
  /*
   * The agents running alongside this one, when a Stage claimed concurrency.
   *
   * Attribution used to be entirely a question of WHEN: everything that
   * changed between the snapshots was this agent's doing. Concurrently that
   * is false, and not in a harmless way — each agent's diff contains its
   * siblings' writes, so both would be failed for work neither did, and the
   * rollback would discard it.
   *
   * So attribution is a question of WHERE. A path one of these siblings
   * declared is that sibling's, and this agent is not answerable for it.
   * That is only sound because a concurrent Stage is refused at load unless
   * its Activities' declared paths are disjoint — without that check, "it
   * belongs to a sibling" would be a way to launder a breach.
   *
   * Empty for a serial Activity, which is every Activity in a serial Stage,
   * so the ordinary case is unchanged.
   */
  siblings: readonly TAgentConfig[] = [],
): readonly string[] => {
  const before = repoBefore.tree
  const after = snapshotTree(run.repoRoot)
  const touched = changedPaths(before, after)
  const committed = commitBreach(repoBefore)
  const resolveFor = (one: TAgentConfig): readonly string[] =>
    resolveWrites(one.writes, run.repoRoot, run.contextHandoffDir)
  const writes = resolveFor(agent)
  const theirs = (path: string): boolean =>
    siblings.some((one) => permitted(path, one, run.cfg, resolveFor(one)))
  const breaches = touched.filter(
    (path) => !(permitted(path, agent, run.cfg, writes) || theirs(path)),
  )
  if (breaches.length === 0 && committed.length === 0) {
    return touched
  }

  const detail = [
    ...breaches.map(
      (path) => `  - ${path} — ${rollBack(run.repoRoot, path, before, after)}`,
    ),
    ...committed.map((note) => `  - ${note}`),
  ].join('\n')
  throw new PermissionBreach(
    `${agent.name} is ${scopeOf(agent, run.cfg)} but overstepped ` +
      `${breaches.length + committed.length} time(s):\n${detail}`,
  )
}
