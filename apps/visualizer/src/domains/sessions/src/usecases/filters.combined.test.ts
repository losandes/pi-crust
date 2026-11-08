import { expect, test } from 'bun:test'
import { DEFAULT_FILTERS } from '../typedefs/filters'
import type { SessionSummary } from '../typedefs/session'
import { matchesFilters, optionsFor, toggled } from './filters'

/**
 * Issue #36, 1.1.4: "A session MUST be shown when, for every category,
 * either the category's selection is empty, or the session's value for that
 * category is in the selection." `filters.test.ts` proves single-category
 * matching in isolation; nothing in that file exercises two constrained
 * categories on the same call, which is the shape every real reader
 * produces the moment they open a second pill. A matcher that silently
 * dropped to the last category checked, or OR'd across categories instead
 * of AND'ing, would still pass every existing case.
 */

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
    'given lib/filters::matchesFilters',
    'when two categories are both constrained and the session satisfies only one of them',
    'it should not match — categories combine with AND, not OR',
  ].join(', '),
  () => {
    // given
    const candidate = session({ workspace: 'alpha', branch: 'feature-x' })
    const filters = {
      ...DEFAULT_FILTERS,
      workspace: ['alpha'],
      branch: ['main'],
    }

    // when
    const actual = matchesFilters(candidate, filters)

    // then
    expect(actual).toBe(false)
  },
)

test(
  [
    'given lib/filters::matchesFilters',
    'when two categories are both constrained and the session satisfies both',
    'it should match',
  ].join(', '),
  () => {
    // given
    const candidate = session({ workspace: 'alpha', branch: 'main' })
    const filters = {
      ...DEFAULT_FILTERS,
      workspace: ['alpha'],
      branch: ['main'],
    }

    // when
    const actual = matchesFilters(candidate, filters)

    // then
    expect(actual).toBe(true)
  },
)

test(
  [
    'given lib/filters::matchesFilters',
    'when a category has two selected values and the session matches the second',
    'it should match — a selection is an OR of its own values',
  ].join(', '),
  () => {
    // given
    const candidate = session({ branch: 'release' })
    const filters = toggled(
      toggled(DEFAULT_FILTERS, 'branch', 'main'),
      'branch',
      'release',
    )

    // when
    const actual = matchesFilters(candidate, filters)

    // then
    expect(actual).toBe(true)
  },
)

test(
  [
    'given lib/filters::matchesFilters',
    'when branch is an empty string and branch is constrained',
    'it should not match, the same as a null value (1.1.6)',
  ].join(', '),
  () => {
    // given
    const candidate = session({ branch: '' as unknown as string })
    const filters = { ...DEFAULT_FILTERS, branch: ['main'] }

    // when
    const actual = matchesFilters(candidate, filters)

    // then
    expect(actual).toBe(false)
  },
)

test(
  [
    'given lib/filters::matchesFilters',
    'when branch is an empty string and branch is unconstrained',
    'it should still match, the category just does not exclude it',
  ].join(', '),
  () => {
    // given
    const candidate = session({ branch: '' as unknown as string })

    // when
    const actual = matchesFilters(candidate, DEFAULT_FILTERS)

    // then
    expect(actual).toBe(true)
  },
)

test(
  [
    'given lib/filters::matchesFilters',
    'when the default filters (archived constrained to active only) are applied to an archived session alongside an active one',
    'it should keep the active session and drop the archived one, with no other category constrained',
  ].join(', '),
  () => {
    // given
    const active = session({ run_id: 'a', archived: 0 })
    const archived = session({ run_id: 'b', archived: 1 })

    // when
    const actual = [active, archived]
      .filter((candidate) => matchesFilters(candidate, DEFAULT_FILTERS))
      .map((candidate) => candidate.run_id)

    // then
    expect(actual).toEqual(['a'])
  },
)

test(
  [
    'given lib/filters::optionsFor',
    'when asked for workspace across sessions that include a null and an empty-string workspace',
    'it should exclude both, offering only non-empty values a reader could actually select (1.1.7)',
  ].join(', '),
  () => {
    // given
    const sessions = [
      session({ run_id: 'a', workspace: 'alpha' }),
      session({ run_id: 'b', workspace: '' }),
      session({ run_id: 'c', workspace: null as unknown as string }),
    ]

    // when
    const actual = optionsFor(sessions, 'workspace')

    // then
    expect(actual).toEqual(['alpha'])
  },
)
