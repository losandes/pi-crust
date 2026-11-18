/** Change capture — git diff facts, no judgement. */

export const BASE_BRANCH_SOURCES = [
  'flag',
  'configuration',
  'remote-default',
  'built-in',
] as const
export type TBaseBranchSource = (typeof BASE_BRANCH_SOURCES)[number]
export const BUILT_IN_BASE_BRANCH = 'main'
export type TBaseBranch = Readonly<{
  name: string
  source: TBaseBranchSource
  /** the remote whose declared default was consulted */
  remote: string
}>

/** Everything captureChanges() needs. One object, never loose params. */
export type TChangeCapture = Readonly<{
  /** the ref the work is measured against */
  base: string
  /** baseBranchProvenance of base; '' when base is a pinned commit */
  namedBy: string
  /** the diff artifact is truncated past this */
  maxDiffLines: number
  /** a brand-new file is part of the change */
  includeUntracked: boolean
}>

export const changeCapture = (
  params: Readonly<Pick<TChangeCapture, 'base'> & Partial<TChangeCapture>>,
): TChangeCapture => ({
  namedBy: '',
  maxDiffLines: 2000,
  includeUntracked: true,
  ...params,
})

/**
 * The commit a change is measured from, and why that one.
 *
 * `reason` is the line the trace shows. A diff is only as trustworthy as the
 * thing it was taken against, so the workflow records that choice instead of
 * leaving the reader to infer it.
 */
export type TBaseRef = Readonly<{
  /** what was asked for: "main", or a pinned sha */
  ref: string
  /** the commit actually diffed against */
  commit: string
  reason: string
}>

/** Display form — a named ref as itself, a pinned raw sha shortened. */
export const baseRefLabel = (base: TBaseRef): string =>
  /^[0-9a-f]{40}$/.test(base.ref) ? base.ref.slice(0, 7) : base.ref

/** What changed since the base commit — pure git facts, no judgement. */
export type TChangeSet = Readonly<{
  base: TBaseRef
  files: readonly string[]
  untracked: readonly string[]
  insertions: number
  deletions: number
  /** `git diff --stat` output, verbatim */
  stat: string
  /** the full diff, written into context_handoff/ */
  diffPath: string
  truncated: boolean
}>

export const changeSetEmpty = (changes: TChangeSet): boolean =>
  changes.files.length === 0 && changes.untracked.length === 0

/**
 * What a `--base` selector resolved to, and why those paths.
 *
 * `to: ''` means the working tree is part of the answer; a two-ended range
 * never includes it, because a range names committed work only.
 */
export type TRangeSelection = Readonly<{
  /** what the developer asked for, verbatim; '' is the working tree */
  spec: string
  from: string
  to: string
  paths: readonly string[]
  /** the line the trace shows — a selection is only as trustworthy as its base */
  reason: string
}>

/** `A..B` and `A...B` name committed work; a bare ref does not. */
export const isRange = (spec: string): boolean => spec.includes('..')
