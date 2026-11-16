import { expect, test } from 'bun:test'
import type { TActivityConfig } from '../../../../lib/contracts'
import { activityConfigSchema } from '../../../../lib/contracts'
import { listAnnotatingHandoffs } from './list-annotating-handoffs'

const anActivity = (
  name: string,
  extra: Readonly<Record<string, unknown>> = {},
): TActivityConfig =>
  activityConfigSchema.parse({
    name,
    prompt_engineering: { system: 's.md', user: 'u.md' },
    ...extra,
  })

for (const { name, activities, expected } of [
  {
    name: 'a review output with undeclared succession',
    activities: [
      anActivity('plan-comprehension', {
        output: 'reviewOutput',
        writes: ['{handoff}/plan_comprehension.md'],
      }),
    ],
    expected: '- plan-comprehension: .handoff/plan_comprehension.md',
  },
  {
    name: 'an explicitly annotating non-review output',
    activities: [
      anActivity('notes', {
        succession: 'annotates',
        output: 'genericOutput',
        writes: ['{handoff}/notes.md'],
      }),
    ],
    expected: '- notes: .handoff/notes.md',
  },
  {
    name: 'an explicitly superseding review output',
    activities: [
      anActivity('review', {
        succession: 'supersedes',
        output: 'reviewOutput',
        writes: ['{handoff}/review.md'],
      }),
    ],
    expected: '(none)',
  },
  {
    name: 'a non-review output with undeclared succession',
    activities: [
      anActivity('plan', {
        output: 'genericOutput',
        writes: ['{handoff}/plan.md'],
      }),
    ],
    expected: '(none)',
  },
  {
    name: 'a nested document unrelated to the Activity name',
    activities: [
      anActivity('sec-review', {
        succession: 'annotates',
        writes: ['{handoff}/verdicts/security.md'],
      }),
    ],
    expected: '- sec-review: .handoff/verdicts/security.md',
  },
  {
    name: 'the Activity being rendered for',
    activities: [
      anActivity('gh-issue', {
        succession: 'annotates',
        writes: ['{handoff}/gh_issue.md'],
      }),
    ],
    expected: '(none)',
  },
  {
    name: 'annotating Activities with absent, empty and wildcard writes',
    activities: [
      anActivity('absent', { succession: 'annotates' }),
      anActivity('empty', { succession: 'annotates', writes: [] }),
      anActivity('wildcard', { succession: 'annotates', writes: ['*'] }),
    ],
    expected: '(none)',
  },
  {
    name: 'an empty registry',
    activities: [],
    expected: '(none)',
  },
  {
    name: 'a document shared with a superseding Activity',
    activities: [
      anActivity('review', {
        output: 'reviewOutput',
        writes: ['{handoff}/plan.md'],
      }),
      anActivity('plan', { writes: ['{handoff}/plan.md'] }),
    ],
    expected: '(none)',
  },
  {
    name: 'two annotating Activities in registry order',
    activities: [
      anActivity('second', {
        output: 'reviewOutput',
        writes: ['{handoff}/second.md'],
      }),
      anActivity('first', {
        succession: 'annotates',
        writes: ['{handoff}/first.md'],
      }),
    ],
    expected: '- second: .handoff/second.md\n- first: .handoff/first.md',
  },
]) {
  test(
    [
      'given use-cases/list-annotating-handoffs::listAnnotatingHandoffs',
      `when the registry contains ${name}`,
      'it should list only eligible annotating documents in registry order',
    ].join(', '),
    () => {
      // given
      const given = {
        activities,
        except: 'gh-issue',
        repoRoot: '/repo',
        handoffDir: '/repo/.handoff',
      }

      // when
      const actual = listAnnotatingHandoffs(given)

      // then
      expect(actual).toBe(expected)
    },
  )
}

for (const { handoffDir, expected } of [
  { handoffDir: '/repo/.handoff', expected: '- review: .handoff/verdict.md' },
  {
    handoffDir: '/outside/handoff',
    expected: '- review: /outside/handoff/verdict.md',
  },
]) {
  test(
    [
      'given use-cases/list-annotating-handoffs::listAnnotatingHandoffs',
      `when the handoff directory is ${handoffDir}`,
      'it should use the policy resolver path form',
    ].join(', '),
    () => {
      // given
      const activities = [
        anActivity('review', {
          output: 'reviewOutput',
          writes: ['{handoff}/verdict.md'],
        }),
      ]

      // when
      const actual = listAnnotatingHandoffs({
        activities,
        except: 'gh-issue',
        repoRoot: '/repo',
        handoffDir,
      })

      // then
      expect(actual).toBe(expected)
    },
  )
}
