/**
 * The dashboard's filter model, kept free of React so it can be tested and
 * reasoned about on its own — components hold state and markup only.
 *
 * Every category's selection is a list of strings, and an empty list is
 * `Select All`: it constrains nothing. A separate boolean or sentinel for
 * "all" would be a second encoding of the same state, which then has to be
 * kept in sync in storage, in matching, and in the pill's on/off class.
 */

export type TFilterKey =
  | 'repository'
  | 'workspace'
  | 'lifecycle'
  | 'status'
  | 'branch'
  | 'archived'

/** Pill order, left to right. */
export const FILTER_KEYS: readonly TFilterKey[] = [
  'repository',
  'workspace',
  'lifecycle',
  'status',
  'branch',
  'archived',
]

export const FILTER_LABELS: Readonly<Record<TFilterKey, string>> = {
  repository: 'repository',
  workspace: 'tree',
  lifecycle: 'lifecycle',
  status: 'status',
  branch: 'branch',
  archived: 'state',
}

/** An empty list is Select All: the category constrains nothing. */
export type TFilters = Readonly<Record<TFilterKey, readonly string[]>>

export const DEFAULT_FILTERS: TFilters = {
  repository: [],
  workspace: [],
  lifecycle: [],
  status: [],
  branch: [],
  archived: ['active'],
}

export const ARCHIVED_OPTIONS: readonly string[] = ['active', 'archived']
export const STATUS_ORDER: readonly string[] = [
  'running',
  'waiting',
  'success',
  'fail',
]
