/**
 * Deterministic change capture: what was built, straight from git.
 *
 * "What changed since main" is not a judgement call — it is two git commands
 * and a subtraction. So it is code, and an agent is only handed the result. The
 * capture writes the full diff into `context_handoff/` and returns a
 * TChangeSet; `changesAsEnvelope` adapts that into the one door every agent
 * handoff uses.
 *
 * The base is resolved, not assumed. Off the base branch the diff covers the
 * whole branch plus the working tree; on it, the uncommitted tree; and on a
 * clean tree, the last commit — because "document the work that was just done"
 * still has an answer right after a chain committed. Whichever it picked rides
 * along in `TBaseRef.reason`, so the trace never leaves you guessing what a
 * diff was measured against.
 */

import { join } from 'node:path'
import type {
  TBaseRef,
  TChangeCapture,
  TChangeSet,
  TChangesOutput,
  TRun,
} from '../../../../lib/contracts'
import { baseRefLabel } from '../../../../lib/contracts'
import { writeText } from '../../../../lib/system'
import * as git from '../data/git'
export const DIFF_FILENAME = 'changes.diff'

/** Pick the commit the work is measured from, and record why that one. */
export const resolveBase = (ref: string): TBaseRef => {
  if (!git.isRepo()) {
    throw new Error(
      'not a git repository — change capture needs one. Run `git init` in ' +
        'the repo root before running a workflow that documents a change.',
    )
  }
  if (!git.refExists(ref)) {
    throw new Error(
      `base ref '${ref}' does not exist in this repository — pass --base ` +
        'with a ref that does (e.g. --base master, --base HEAD~1).',
    )
  }

  // Built first, then given its reason: the label knows how to print a pinned
  // sha, and the reason is the line a human reads in the trace.
  const commit = git.mergeBase(ref, 'HEAD')
  const label = baseRefLabel({ ref, commit, reason: '' })
  if (git.shortSha(commit) !== git.shortSha('HEAD')) {
    return {
      ref,
      commit,
      reason: `HEAD is ahead of ${label} — diffing every commit since, plus the working tree`,
    }
  }
  if (git.isDirty()) {
    return {
      ref,
      commit,
      reason: `HEAD is on ${label} — diffing the uncommitted working tree`,
    }
  }
  if (git.refExists('HEAD~1')) {
    return {
      ref,
      commit: git.rev('HEAD~1'),
      reason: `HEAD is on ${label} with a clean tree — falling back to the last commit`,
    }
  }
  return {
    ref,
    commit,
    reason: `HEAD is on ${label} with a clean tree and no parent commit`,
  }
}

/** Diff the working tree against the resolved base and persist the evidence. */
export const captureChanges = (
  run: TRun,
  params: TChangeCapture,
): TChangeSet => {
  const base = resolveBase(params.base)
  const files = git.diffFiles(base.commit)
  const untracked = params.includeUntracked ? git.untrackedFiles() : []
  const { insertions, deletions } = git.diffCounts(base.commit)
  const stat = git.diffStat(base.commit)

  const full = git.diffText(base.commit)
  const lines = full.split('\n')
  const truncated = lines.length > params.maxDiffLines
  const text = truncated
    ? `${lines.slice(0, params.maxDiffLines).join('\n')}\n\n[truncated at ` +
      `${params.maxDiffLines} lines of ${lines.length} — run ` +
      `\`git diff ${base.commit}\` for the rest]`
    : full

  // Untracked files are absent from `git diff` by construction, so they are
  // named here rather than silently missing from the record. The reader has
  // `read` and can open any of them.
  const untrackedBlock =
    untracked.length > 0
      ? untracked.map((file) => `  ${file}`).join('\n')
      : '  (none)'
  const diffPath = join(run.contextHandoffDir, DIFF_FILENAME)
  writeText(
    diffPath,
    `# changes since ${baseRefLabel(base)} @ ${git.shortSha(base.commit)}\n` +
      `# ${base.reason}\n` +
      `# +${insertions} -${deletions} across ${files.length} tracked file(s)\n\n` +
      `## stat\n${stat || '  (no tracked changes)'}\n\n` +
      `## untracked files\n${untrackedBlock}\n\n` +
      `## diff\n${text}\n`,
  )

  return {
    base,
    files,
    untracked,
    insertions,
    deletions,
    stat,
    diffPath,
    truncated,
  }
}

/** Wrap a captured change so an agent can be handed it directly. */
export const changesAsEnvelope = (
  changes: TChangeSet,
  notes = '',
): TChangesOutput => {
  const total = changes.files.length + changes.untracked.length
  const label = baseRefLabel(changes.base)
  return {
    status: 'success',
    summary:
      `${total} file(s) changed since ${label} ` +
      `(+${changes.insertions} -${changes.deletions})`,
    artifacts: [changes.diffPath],
    notes_for_next_agent: notes,
    base: `${label} @ ${git.shortSha(changes.base.commit)} — ${changes.base.reason}`,
    changed_files: [...changes.files, ...changes.untracked],
    insertions: changes.insertions,
    deletions: changes.deletions,
    stat: changes.stat,
    diff_path: changes.diffPath,
  }
}
