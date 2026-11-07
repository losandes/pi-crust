import { expect, test } from 'bun:test'
import {
  FILTER_STORAGE_KEY,
  readFilters,
  saveFilters,
} from '../state/filters-store'
import {
  ARCHIVED_OPTIONS,
  DEFAULT_FILTERS,
  STATUS_ORDER,
} from '../typedefs/filters'
import type { SessionSummary } from '../typedefs/session'
import {
  cleared,
  isOptimisticallyHidden,
  matchesFilters,
  matchingOptions,
  needsArchived,
  optionsFor,
  toggled,
} from './filters'

const session = (overrides: Partial<SessionSummary>): SessionSummary =>
  ({
    run_id: 'run-1',
    lifecycle: 'plan + build',
    request: null,
    status: 'success',
    engineer: null,
    started_at: null,
    ended_at: null,
    total_tokens: null,
    total_cost: null,
    archived: 0,
    workspace_root: null,
    branch: 'main',
    name: null,
    workspace: 'alpha',
    activityRuns: [],
    activity_run_count: 0,
    agents: [],
    ...overrides,
  }) as SessionSummary

test(
  [
    'given lib/filters::DEFAULT_FILTERS',
    'when read directly',
    'it should leave every category empty except archived, which is active-only',
  ].join(', '),
  () => {
    // given, when
    const actual = DEFAULT_FILTERS

    // then
    expect(actual).toEqual({
      workspace: [],
      lifecycle: [],
      status: [],
      branch: [],
      archived: ['active'],
    })
  },
)

test(
  [
    'given lib/filters::matchesFilters',
    'when the category is unconstrained',
    'it should match regardless of the value',
  ].join(', '),
  () => {
    // given
    const run = session({ workspace: 'alpha' })

    // when
    const actual = matchesFilters(run, DEFAULT_FILTERS)

    // then
    expect(actual).toBe(true)
  },
)

test(
  [
    'given lib/filters::matchesFilters',
    'when a category is constrained to another value',
    'it should not match',
  ].join(', '),
  () => {
    // given
    const run = session({ workspace: 'alpha' })
    const filters = { ...DEFAULT_FILTERS, workspace: ['beta'] }

    // when
    const actual = matchesFilters(run, filters)

    // then
    expect(actual).toBe(false)
  },
)

test(
  [
    'given lib/filters::matchesFilters',
    'when lifecycle is null and lifecycle is constrained',
    'it should not match',
  ].join(', '),
  () => {
    // given
    const run = session({ lifecycle: null })
    const filters = { ...DEFAULT_FILTERS, lifecycle: ['plan + build'] }

    // when
    const actual = matchesFilters(run, filters)

    // then
    expect(actual).toBe(false)
  },
)

test(
  [
    'given lib/filters::matchesFilters',
    'when lifecycle is null and lifecycle is unconstrained',
    'it should match',
  ].join(', '),
  () => {
    // given
    const run = session({ lifecycle: null })

    // when
    const actual = matchesFilters(run, DEFAULT_FILTERS)

    // then
    expect(actual).toBe(true)
  },
)

test(
  [
    'given lib/filters::optionsFor',
    'when asked for workspace',
    'it should sort the distinct values with localeCompare',
  ].join(', '),
  () => {
    // given
    const sessions = [
      session({ workspace: 'zeta' }),
      session({ workspace: 'alpha' }),
      session({ workspace: 'alpha' }),
    ]

    // when
    const actual = optionsFor(sessions, 'workspace')

    // then
    expect(actual).toEqual(['alpha', 'zeta'])
  },
)

test(
  [
    'given lib/filters::optionsFor',
    'when asked for status',
    'it should order by STATUS_ORDER rather than by arrival',
  ].join(', '),
  () => {
    // given
    const sessions = [
      session({ status: 'fail' }),
      session({ status: 'running' }),
      session({ status: 'success' }),
    ]

    // when
    const actual = optionsFor(sessions, 'status')

    // then
    expect(actual).toEqual(['running', 'success', 'fail'])
    expect(STATUS_ORDER).toEqual(['running', 'waiting', 'success', 'fail'])
  },
)

test(
  [
    'given lib/filters::optionsFor',
    'when asked for archived',
    'it should return both options even when no session is archived',
  ].join(', '),
  () => {
    // given
    const sessions = [session({ archived: 0 })]

    // when
    const actual = optionsFor(sessions, 'archived')

    // then
    expect(actual).toEqual(ARCHIVED_OPTIONS)
  },
)

test(
  [
    'given lib/filters::toggled',
    'when a value is toggled on then off',
    'it should add it and then remove it',
  ].join(', '),
  () => {
    // given
    const added = toggled(DEFAULT_FILTERS, 'workspace', 'alpha')

    // when
    const removed = toggled(added, 'workspace', 'alpha')

    // then
    expect(added.workspace).toEqual(['alpha'])
    expect(removed.workspace).toEqual([])
  },
)

test(
  [
    'given lib/filters::cleared',
    'when one category is cleared',
    'it should empty only that category and leave the rest alone',
  ].join(', '),
  () => {
    // given
    const filters = {
      ...DEFAULT_FILTERS,
      workspace: ['alpha'],
      status: ['fail'],
    }

    // when
    const actual = cleared(filters, 'workspace')

    // then
    expect(actual.workspace).toEqual([])
    expect(actual.status).toEqual(['fail'])
  },
)

test(
  [
    'given lib/filters::matchingOptions',
    'when searching with mixed case',
    'it should match case-insensitively',
  ].join(', '),
  () => {
    // given
    const options = ['Alpha', 'beta', 'Gamma']

    // when
    const actual = matchingOptions(options, 'A')

    // then
    expect(actual).toEqual(['Alpha', 'beta', 'Gamma'])
  },
)

test(
  [
    'given lib/filters::needsArchived',
    'when archived is the default active-only selection',
    'it should be false',
  ].join(', '),
  () => {
    // given, when
    const actual = needsArchived(DEFAULT_FILTERS)

    // then
    expect(actual).toBe(false)
  },
)

test(
  [
    'given lib/filters::needsArchived',
    'when archived is unconstrained',
    'it should be true',
  ].join(', '),
  () => {
    // given
    const filters = { ...DEFAULT_FILTERS, archived: [] }

    // when
    const actual = needsArchived(filters)

    // then
    expect(actual).toBe(true)
  },
)

test(
  [
    'given lib/filters::needsArchived',
    'when archived is constrained to archived only',
    'it should be true',
  ].join(', '),
  () => {
    // given
    const filters = { ...DEFAULT_FILTERS, archived: ['archived'] }

    // when
    const actual = needsArchived(filters)

    // then
    expect(actual).toBe(true)
  },
)

test(
  [
    'given lib/filters::readFilters',
    'when the stored payload is malformed JSON',
    'it should fall back to the defaults for the whole object',
  ].join(', '),
  () => {
    // given
    const storage = { getItem: () => 'not json' }

    // when
    const actual = readFilters(storage)

    // then
    expect(actual).toEqual(DEFAULT_FILTERS)
  },
)

test(
  [
    'given lib/filters::readFilters',
    'when a key is missing from the stored payload',
    'it should fall back to that key default alone',
  ].join(', '),
  () => {
    // given
    const storage = {
      getItem: () => JSON.stringify({ workspace: ['alpha'] }),
    }

    // when
    const actual = readFilters(storage)

    // then
    expect(actual.workspace).toEqual(['alpha'])
    expect(actual.archived).toEqual(['active'])
  },
)

test(
  [
    'given lib/filters::readFilters',
    'when a key holds non-strings',
    'it should drop them and fall back to that key default',
  ].join(', '),
  () => {
    // given
    const storage = {
      getItem: () =>
        JSON.stringify({ workspace: ['alpha', 1, null], branch: [2, 3] }),
    }

    // when
    const actual = readFilters(storage)

    // then
    expect(actual.workspace).toEqual(['alpha'])
    expect(actual.branch).toEqual([])
  },
)

test(
  [
    'given lib/filters::readFilters',
    'when the storage throws',
    'it should fall back to the defaults rather than propagate',
  ].join(', '),
  () => {
    // given
    const storage = {
      getItem: () => {
        throw new Error('blocked')
      },
    }

    // when
    const actual = readFilters(storage)

    // then
    expect(actual).toEqual(DEFAULT_FILTERS)
  },
)

test(
  [
    'given lib/filters::saveFilters',
    'when the storage throws',
    'it should swallow the error rather than propagate',
  ].join(', '),
  () => {
    // given
    const storage = {
      setItem: () => {
        throw new Error('blocked')
      },
    }

    // when
    const act = () => saveFilters(storage, DEFAULT_FILTERS)

    // then
    expect(act).not.toThrow()
  },
)

test(
  [
    'given lib/filters::FILTER_STORAGE_KEY',
    'when read directly',
    'it should be the documented storage key',
  ].join(', '),
  () => {
    // given, when
    const actual = FILTER_STORAGE_KEY

    // then
    expect(actual).toBe('crust.filters')
  },
)

test(
  [
    'given lib/filters::isOptimisticallyHidden',
    'when a just-archived run still polls with archived false',
    'it should stay optimistically hidden',
  ].join(', '),
  () => {
    // given
    const run = session({ run_id: 'run-1', archived: 0 })

    // when
    const actual = isOptimisticallyHidden(run, ['run-1'])

    // then
    expect(actual).toBe(true)
  },
)

test(
  [
    'given lib/filters::isOptimisticallyHidden',
    'when the server confirms the archive write',
    'it should stop being optimistically hidden',
  ].join(', '),
  () => {
    // given
    const run = session({ run_id: 'run-1', archived: 1 })

    // when
    const actual = isOptimisticallyHidden(run, ['run-1'])

    // then
    expect(actual).toBe(false)
  },
)
