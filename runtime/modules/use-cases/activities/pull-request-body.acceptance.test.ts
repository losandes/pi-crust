/**
 * Independent acceptance coverage for issue #58 ("Make gh-pull-request
 * bodies evidence-backed, not agent-argued"), written from the issue's own
 * success criteria and the plan's section 2 worked example — not from
 * reading `pull-request-body.ts`'s implementation. `pull-request-body.test.ts`
 * already exercises most unit-level cases; this file proves the success
 * criteria hold end to end and covers edge cases that file does not:
 * multiple issue-number sources deduplicating together, a nested
 * subheading being removed along with its parent, several declared checks
 * that never ran, and the whole worked example from the issue rendering as
 * one coherent body.
 */

import { expect, test } from 'bun:test'
import type {
  TActivityRunState,
  TEnvelopeRecord,
  TRunState,
} from '../../typedefs/run-state'
import type { TBodyFacts } from './pull-request-body'
import {
  agentProse,
  checksSection,
  composedBody,
  issueRefs,
} from './pull-request-body'

const activityRun = (
  overrides: Readonly<Partial<TActivityRunState>> = {},
): TActivityRunState => ({
  seq: 1,
  activity_run_id: 'id_1',
  name: 'build',
  kind: 'agent',
  owner: 'build',
  description: '',
  status: 'success',
  error: undefined,
  started_at: undefined,
  ended_at: undefined,
  gates: [],
  logs: [],
  ...overrides,
})

const envelope = (
  overrides: Readonly<Partial<TEnvelopeRecord>> = {},
): TEnvelopeRecord => ({
  activityRun: 'build',
  agent: 'build',
  output_type: 'BuildOutput',
  valid: true,
  payload: {},
  ...overrides,
})

const aState = (overrides: Readonly<Partial<TRunState>> = {}): TRunState => ({
  run_id: 'aaaa1111',
  lifecycle: 'sdlc',
  name: '',
  request: '',
  status: 'success',
  engineer: 'tester',
  started_at: undefined,
  ended_at: undefined,
  tokens: 0,
  cost: 0,
  activityRuns: [],
  completed: [],
  resume_from: undefined,
  resumable: false,
  failed_gates: [],
  warnings: [],
  envelopes: [],
  ...overrides,
})

const aFacts = (overrides: Readonly<Partial<TBodyFacts>> = {}): TBodyFacts => ({
  runId: 'aaaa1111',
  prompt: '',
  state: undefined,
  declaredChecks: [],
  uncommitted: [],
  composedBy: 'gh-pull-request',
  ...overrides,
})

// ── success criterion 1: issue linking (1.1.3) ──────────────────────────

test(
  [
    'given pull-request-body::issueRefs',
    'when the same issue number is named in the prompt, the request and an envelope',
    'it should return it once',
  ].join(', '),
  () => {
    // given — three sources the spec names (1.1.3) all naming #54
    const state = aState({
      request: 'implements #54',
      envelopes: [
        envelope({ activityRun: 'gh-issue', payload: { issue_number: 54 } }),
      ],
    })
    const facts = aFacts({ prompt: 'closes #54', state })

    // when
    const actual = issueRefs(facts)

    // then
    expect(actual).toEqual([54])
  },
)

test(
  [
    'given pull-request-body::issueRefs',
    'when different issues are named across the prompt, the request and an envelope',
    'it should return all of them, ascending and deduplicated',
  ].join(', '),
  () => {
    // given
    const state = aState({
      request: 'also touches #7',
      envelopes: [
        envelope({ activityRun: 'gh-issue', payload: { issue_number: 61 } }),
      ],
    })
    const facts = aFacts({ prompt: 'closes #54, see #7', state })

    // when
    const actual = issueRefs(facts)

    // then
    expect(actual).toEqual([7, 54, 61])
  },
)

// ── success criterion 5: section removal keeps nested structure together (1.5.3) ──

test(
  [
    'given pull-request-body::agentProse',
    "when the agent's own '## Checks' section carries a nested '###' subheading",
    'it should remove the subheading along with the section that owns it',
  ].join(', '),
  () => {
    // given — an agent that wrote a `### Lint` subsection under its own
    // (forbidden) '## Checks' heading; 1.5.3 says a `###` inside a removed
    // section goes with it rather than surviving as an orphan.
    const body = [
      '## What changed',
      '',
      'Did the thing.',
      '',
      '## Checks',
      '',
      '### Lint',
      '',
      '- [x] made this up',
      '',
      '## Out of scope',
      '',
      'Nothing.',
    ].join('\n')

    // when
    const actual = agentProse(body)

    // then
    expect(actual).not.toContain('### Lint')
    expect(actual).not.toContain('made this up')
    expect(actual).toContain('## Out of scope')
    expect(actual).toContain('Did the thing.')
  },
)

// ── success criterion 4: Checks is computed, not agent prose (1.4.4) ────

test(
  [
    'given pull-request-body::checksSection',
    'when several declared routing checks never ran in this run',
    'it should render each one unchecked, in sorted order',
  ].join(', '),
  () => {
    // given
    const facts = aFacts({
      state: aState(),
      declaredChecks: ['typecheck', 'lint'],
    })

    // when
    const actual = checksSection(facts)

    // then
    const lines = actual
      .split('\n')
      .filter((line) => line.includes('declared in routing.checks'))
    expect(lines).toEqual([
      '- [ ] lint — declared in routing.checks; no gate recorded it in this run',
      '- [ ] typecheck — declared in routing.checks; no gate recorded it in this run',
    ])
  },
)

// ── the issue's own worked example, assembled end to end ────────────────

test(
  [
    'given pull-request-body::composedBody',
    "when a run's trace matches the issue's own worked example",
    'it should deliver the issue link, a per-Activity record and a Checks list that trace to recorded outcomes — not to agent prose',
  ].join(', '),
  () => {
    // given — two Activities (`build`, `code-review`) with recorded gates
    // and envelopes, one declared check that never ran, and two dirty
    // paths, reproducing the shape of the issue's "delivered shape" example
    const state = aState({
      activityRuns: [
        activityRun({
          seq: 1,
          name: 'build',
          gates: [
            {
              gate: 'diff_matches_claims',
              activityRun: 'build',
              passed: true,
              violations: [],
              checks: [],
            },
            {
              gate: 'checks',
              activityRun: 'build',
              passed: false,
              violations: [],
              checks: [{ item: 'test', ok: true, note: '`bun test` exited 0' }],
            },
          ],
        }),
        activityRun({
          seq: 2,
          name: 'code-review',
          status: 'success',
          gates: [
            {
              gate: 'artifacts_exist',
              activityRun: 'code-review',
              passed: true,
              violations: [],
              checks: [],
            },
            {
              gate: 'verdict_consistent',
              activityRun: 'code-review',
              passed: false,
              violations: ['the envelope claimed success but a gate failed'],
              checks: [],
            },
          ],
        }),
      ],
      envelopes: [
        envelope({
          activityRun: 'build',
          payload: {
            summary:
              'Implemented the flag table and the shared positional parser.',
            decisions: [
              {
                decision:
                  'Normalised short flags inside read() — one resolution point keeps TCliArgs free of aliases.',
              },
            ],
          },
        }),
        envelope({
          activityRun: 'code-review',
          payload: {
            summary:
              'New tests comply with the TypeScript testing ADR; one non-blocking style observation.',
          },
        }),
      ],
    })
    const facts = aFacts({
      prompt: 'ship it, closes #54',
      state,
      declaredChecks: ['typecheck'],
      uncommitted: ['runtime/a.ts', 'runtime/b.ts'],
    })
    const agentBody = [
      '## What changed',
      '',
      'Added the flag table.',
      '',
      '## Checks',
      '',
      '- [x] everything is fine, trust me',
      '',
      '## Out of scope',
      '',
      'Nothing further.',
    ].join('\n')

    // when
    const actual = composedBody(agentBody, facts)

    // then — criterion 1: closing keyword, derived only from facts the spec
    // names, never from the agent's own prose
    expect(actual.startsWith('closes #54')).toBe(true)

    // then — criterion 3: every Activity that ran appears with its own
    // envelope-derived answer and decisions, not just the Stage directly
    // upstream of gh-pull-request
    expect(actual).toContain('### build')
    expect(actual).toContain(
      '- Answer: Implemented the flag table and the shared positional parser.',
    )
    expect(actual).toContain('- Decisions')
    expect(actual).toContain(
      '  - Normalised short flags inside read() — one resolution point keeps TCliArgs free of aliases.',
    )
    expect(actual).toContain('### code-review')
    expect(actual).toContain(
      '- Answer: New tests comply with the TypeScript testing ADR; one non-blocking style observation.',
    )
    expect(actual).not.toContain('### gh-pull-request')

    // then — criterion 4: Checks reflects recorded outcomes, not the
    // agent's own account — the agent's invented line never survives, a
    // failing gate with no per-item checks still produces an unchecked
    // line, a declared-but-unrun check is unchecked, and the dirty tree is
    // reported
    expect(actual).not.toContain('everything is fine, trust me')
    expect(actual).toContain(
      '- [x] test — `bun test` exited 0 (checks gate, build)',
    )
    expect(actual).toContain(
      '- [ ] verdict_consistent — the envelope claimed success but a gate failed (verdict_consistent gate, code-review)',
    )
    expect(actual).toContain(
      '- [ ] typecheck — declared in routing.checks; no gate recorded it in this run',
    )
    expect(actual).toContain(
      '- [ ] every change committed — 2 path(s) are not in this pull request: runtime/a.ts, runtime/b.ts',
    )

    // then — criterion 2: nothing in the delivered body argues the change
    // is safe, ready, or should be merged
    expect(actual).not.toMatch(/safe to merge/i)
    expect(actual).not.toMatch(/ready to merge/i)
    expect(actual).not.toMatch(/should be merged/i)

    // then — ordering: harness sections land between the agent's prose and
    // its own '## Out of scope' (1.5.2)
    const changedIndex = actual.indexOf('Added the flag table.')
    const activitiesIndex = actual.indexOf('## Activities')
    const checksIndex = actual.indexOf('## Checks')
    const outOfScopeIndex = actual.indexOf('## Out of scope')
    expect(changedIndex).toBeGreaterThan(-1)
    expect(activitiesIndex).toBeGreaterThan(changedIndex)
    expect(checksIndex).toBeGreaterThan(activitiesIndex)
    expect(outOfScopeIndex).toBeGreaterThan(checksIndex)
  },
)
