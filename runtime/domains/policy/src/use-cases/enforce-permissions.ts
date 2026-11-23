/**
 * What an agent may CHANGE, observed in code after the fact.
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
 * the fact, against snapshots and paths changed in history supplied by the
 * caller. `enforcePermissions()` compares the before and after change-sets,
 * includes those history paths and REPORTS what changed outside the allowlist;
 * it never reads the tree or HEAD itself.
 *
 * Comparing change-sets, rather than watching for writes, is what catches the
 * `git checkout` case: a path that was modified before the agent ran and is
 * clean afterwards has been reverted, and a reversion is a modification.
 * Appearing, disappearing, and changing all count.
 *
 * What it does NOT do is undo anything, and that is the point of this module
 * now. It used to `git checkout --` a tracked file and unlink an untracked
 * one, on the theory that everything which changed while an agent ran was the
 * agent's. That theory is false for a developer working in the same branch,
 * which is a supported way to use this tool: observed once as a developer's
 * uncommitted edit to pi-crust.toml being discarded with no stash, no
 * commit and no way back. Detection is unchanged; the response is a report.
 *
 * A report is not a gate violation either. Gates are for work an agent can be
 * asked to redo; this already happened, and re-prompting cannot unhappen it.
 * The paths worth defending are defended before the call instead, by the path
 * policy — which knows whose call it was.
 *
 * Two keys drive it, both in pi-crust.toml:
 *     defaults.protected_files   paths no agent may touch unless it names them
 *     agents[].writes   ['*'] = unrestricted · [] = read-only · [...] = only these
 */

import { resolve } from 'node:path'
import type {
  TAgentConfig,
  TPiCrustConfig,
  TRun,
} from '../../../../lib/contracts'
import type { TTreeSnapshot } from '../../../workspace'
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
 * `.pi-crust/config/*.yaml` would match `.pi-crust/config/nested/x.yaml` as
 * well as the files it means. `**` is the way to say "cross directories".
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
export const alwaysWritable = (
  cfg: TPiCrustConfig,
  /**
   * This run's handoff directory. Granted alongside `data_dir` so a
   * `--handoff` relocated outside `data_dir` does not turn a legitimate
   * undeclared write in an agent's own handoff directory into a reported
   * overstep.
   */
  handoffDir?: string,
): readonly string[] => [
  `${cfg.defaults.data_dir.replace(/\/+$/, '')}/`,
  ...(handoffDir === undefined ? [] : [`${handoffDir.replace(/\/+$/, '')}/`]),
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
 * A handoff directory, spelled the way a tree snapshot would report it:
 * repo-relative when it is inside the repository, absolute when it is not.
 * An agent's declared paths resolve against this, with `{handoff}` filled
 * in — and `alwaysWritable`'s grant widens to match, so a relocated handoff
 * directory does not turn a legitimate undeclared write into an overstep.
 */
const handoffRelativeTo = (repoRoot: string, handoffDir: string): string => {
  const absolute = resolve(handoffDir)
  const root = `${resolve(repoRoot)}/`
  return absolute.startsWith(root) ? absolute.slice(root.length) : absolute
}

export const resolveWrites = (
  writes: readonly string[],
  repoRoot: string,
  handoffDir: string,
): readonly string[] => {
  const relative = handoffRelativeTo(repoRoot, handoffDir)

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
  /** this run's handoff directory; widens the always-writable grant to match */
  handoffDir?: string,
): boolean => {
  /*
   * 1.9.3: `path` here is a CHANGED path from the working tree's own diff —
   * always repository-relative — matched against `alwaysWritable`'s patterns,
   * which are themselves repository-relative whenever `data_dir` resolves
   * inside the repository. A `data_dir` outside the repository (1.1, a
   * pooled store) never appears in that diff at all, so this grant simply
   * never has anything to fire against for it; `permitted` has nothing to
   * widen because there is nothing out-of-tree to report a changed path
   * against in the first place. The in-repository case is unchanged: an
   * agent's own session runtime stays always-writable there.
   */
  if (
    alwaysWritable(cfg, handoffDir).some((pattern) =>
      matchesPattern(path, pattern),
    )
  ) {
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

const scopeOf = (agent: TAgentConfig, cfg: TPiCrustConfig): string => {
  if (agent.writes.includes('*')) {
    return `barred from ${cfg.defaults.protected_files.join(', ')}`
  }
  return agent.writes.length === 0
    ? 'read-only'
    : `limited to ${agent.writes.join(', ')}`
}

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

/** Where the repository is after an Activity touched it. */
export type TRepoAfter = Readonly<{
  tree: TTreeSnapshot
  /** HEAD after the Activity ran; '' outside a repository */
  head: string
  /**
   * Paths whose committed content differs between `TRepoBefore.head` and
   * `head`, spelled as the keys of `tree` are; [] when history did not move.
   */
  history: readonly string[]
}>

/**
 * A commit nobody authorised, reported like any other breach.
 *
 * Not rolled back. Resetting history under a developer is a bigger harm than
 * the commit was, and the commit is recoverable by whoever reads the report.
 */
export const commitBreach = (
  before: TRepoBefore,
  after: TRepoAfter,
): readonly string[] => {
  if (before.committing || before.head === '' || after.head === '') {
    return []
  }

  return after.head === before.head
    ? []
    : [
        `HEAD moved from ${before.head.slice(0, 7)} to ${after.head.slice(0, 7)} — ` +
          "this activity was not committing, and committing is the engine's " +
          'to do. Left in history; undo it yourself if it is wrong.',
      ]
}

/**
 * What one Activity Run did to the repository, as facts rather than a verdict.
 *
 * It used to be a throw and a list of paths. The throw is gone — an overstep
 * no longer kills the chain, because the response that made killing it worth
 * doing (undoing the write) is the thing that had to go. What is left is a
 * record, and the surfaces that print it.
 */
export type TPermissionReport = Readonly<{
  /**
   * Every path this Activity Run was observed to change, minus any path a
   * concurrent sibling declared. What a commit is built from.
   */
  touched: readonly string[]
  /** the subset it had no permission to change */
  overstepped: readonly string[]
  /** the agent's permission, in words, for the report that names the overstep */
  scope: string
  /** a moved `HEAD` under an Activity that was not committing, as a sentence */
  committed: readonly string[]
  /** paths already dirty when this Activity Run started — never its doing */
  dirtyBefore: readonly string[]
}>

/**
 * Does one of these patterns NAME this path?
 *
 * Deliberately not `permitted`: that answers "may this agent change it",
 * which `writes: ['*']` makes true of everything and which the session
 * runtime makes true for every agent. Ownership between concurrent siblings
 * has to be narrower than permission, or an unrestricted neighbour would own
 * the whole tree and this Activity would commit none of its own work.
 */
export const declaredBy = (path: string, writes: readonly string[]): boolean =>
  writes
    .filter((pattern) => pattern !== '*')
    .some((pattern) => matchesPattern(path, pattern))

export const enforcePermissions = (
  run: TRun,
  agent: TAgentConfig,
  repoBefore: TRepoBefore,
  repoAfter: TRepoAfter,
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
): TPermissionReport => {
  const before = repoBefore.tree
  const after = repoAfter.tree
  const touched = [
    ...new Set([...changedPaths(before, after), ...repoAfter.history]),
  ].toSorted()
  const resolveFor = (one: TAgentConfig): readonly string[] =>
    resolveWrites(one.writes, run.repoRoot, run.contextHandoffDir)
  const writes = resolveFor(agent)
  const theirs = (path: string): boolean =>
    siblings.some((one) => declaredBy(path, resolveFor(one)))

  return {
    /*
     * A sibling's declared path is a sibling's work, and this Activity must
     * not carry it: this set goes on to decide what the Activity COMMITS,
     * and a commit of a neighbour's half-written file is the concurrent
     * spelling of `git add -A`.
     */
    touched: touched.filter((path) => !theirs(path)),
    overstepped: touched.filter(
      (path) =>
        !(
          permitted(
            path,
            agent,
            run.cfg,
            writes,
            handoffRelativeTo(run.repoRoot, run.contextHandoffDir),
          ) || theirs(path)
        ),
    ),
    scope: scopeOf(agent, run.cfg),
    committed: commitBreach(repoBefore, repoAfter),
    dirtyBefore: Object.keys(before).toSorted(),
  }
}
