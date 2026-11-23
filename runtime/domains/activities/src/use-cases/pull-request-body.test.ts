import { expect, test } from 'bun:test'
import type {
  TActivityRunState,
  TEnvelopeRecord,
  TRunState,
} from '../../../../lib/contracts'
import type { TBodyFacts } from './pull-request-body'
import {
  activitiesSection,
  agentProse,
  checksSection,
  composedBody,
  ISSUE_LINK_LIMIT,
  issueLine,
  issueRefs,
  MAX_LEDGER_ITEMS,
  titleWithIssues,
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

// ── issue linking ────────────────────────────────────────────────────────

test(
  [
    'given pull-request-body::issueRefs',
    'when the prompt names one issue',
    'it should return that number',
  ].join(', '),
  () => {
    // given
    const facts = aFacts({ prompt: 'fix the thing, closes #54' })

    // when
    const actual = issueRefs(facts)

    // then
    expect(actual).toEqual([54])
  },
)

test(
  [
    'given pull-request-body::issueRefs',
    'when an envelope carries a positive integer issue_number',
    'it should include it',
  ].join(', '),
  () => {
    // given
    const state = aState({
      envelopes: [
        envelope({ activityRun: 'gh-issue', payload: { issue_number: 61 } }),
      ],
    })
    const facts = aFacts({ prompt: 'ship it', state })

    // when
    const actual = issueRefs(facts)

    // then
    expect(actual).toEqual([61])
  },
)

test(
  [
    'given pull-request-body::issueRefs',
    'when a github issue URL appears in the request',
    'it should extract the number',
  ].join(', '),
  () => {
    // given
    const state = aState({
      request: 'see https://github.com/acme/widget/issues/7',
    })
    const facts = aFacts({ state })

    // when
    const actual = issueRefs(facts)

    // then
    expect(actual).toEqual([7])
  },
)

test(
  [
    'given pull-request-body::issueLine',
    'when 1 to 3 issues are referenced',
    'it should repeat the closing keyword per issue',
  ].join(', '),
  () => {
    // given
    // when
    const actual = issueLine([54, 55])

    // then
    expect(actual).toEqual('closes #54, closes #55')
  },
)

test(
  [
    'given pull-request-body::issueLine',
    'when more than 3 issues are referenced',
    'it should use a plain reference line with no closing keyword',
  ].join(', '),
  () => {
    // given
    const refs = [1, 2, 3, 4]
    expect(refs.length).toBeGreaterThan(ISSUE_LINK_LIMIT)

    // when
    const actual = issueLine(refs)

    // then
    expect(actual).toEqual('Refs #1, #2, #3, #4')
    expect(actual).not.toMatch(/closes/)
  },
)

test(
  [
    'given pull-request-body::issueLine',
    'when no issue is referenced',
    'it should return an empty string',
  ].join(', '),
  () => {
    // given
    // when
    const actual = issueLine([])

    // then
    expect(actual).toEqual('')
  },
)

test(
  [
    'given pull-request-body::titleWithIssues',
    'when the suffix fits under 72 characters',
    'it should append it',
  ].join(', '),
  () => {
    // given
    // when
    const actual = titleWithIssues('Ship the feature', [54])

    // then
    expect(actual).toEqual('Ship the feature (#54)')
  },
)

test(
  [
    'given pull-request-body::titleWithIssues',
    'when the title plus suffix would exceed 72 characters',
    'it should truncate the base title, not the suffix',
  ].join(', '),
  () => {
    // given
    const longTitle = 'A'.repeat(70)

    // when
    const actual = titleWithIssues(longTitle, [54])

    // then
    expect(actual.length).toBeLessThanOrEqual(72)
    expect(actual).toMatch(/\(#54\)$/)
  },
)

test(
  [
    'given pull-request-body::titleWithIssues',
    'when more than 3 issues are referenced',
    'it should add no suffix',
  ].join(', '),
  () => {
    // given
    // when
    const actual = titleWithIssues('Ship the feature', [1, 2, 3, 4])

    // then
    expect(actual).toEqual('Ship the feature')
  },
)

test(
  [
    'given pull-request-body::titleWithIssues',
    'when the title already names every reference',
    'it should not add a second suffix',
  ].join(', '),
  () => {
    // given
    // when
    const actual = titleWithIssues('Ship the feature (#54)', [54])

    // then
    expect(actual).toEqual('Ship the feature (#54)')
  },
)

// ── '## Activities' ──────────────────────────────────────────────────────

test(
  [
    'given pull-request-body::activitiesSection',
    'when an Activity has an envelope with decisions, assumptions and questions',
    'it should render the groups from the payload',
  ].join(', '),
  () => {
    // given
    const state = aState({
      activityRuns: [
        activityRun({
          gates: [
            {
              gate: 'checks',
              activityRun: 'build',
              passed: true,
              violations: [],
              checks: [],
            },
          ],
        }),
      ],
      envelopes: [
        envelope({
          payload: {
            summary: 'Implemented the thing.',
            decisions: [{ decision: 'Used a map', rationale: 'fast lookup' }],
            assumptions: [
              {
                assumption: 'inputs are trimmed',
                invalidated_by: 'a counter-example',
              },
            ],
            unresolved: [
              { question: 'should this retry?', consequential: true },
            ],
          },
        }),
      ],
    })
    const facts = aFacts({ state })

    // when
    const actual = activitiesSection(facts)

    // then
    expect(actual).toContain('### build')
    expect(actual).toContain('- Answer: Implemented the thing.')
    expect(actual).toContain('- Status: success')
    expect(actual).toContain('- Decisions')
    expect(actual).toContain('  - Used a map')
    expect(actual).toContain('- Assumptions')
    expect(actual).toContain('  - inputs are trimmed')
    expect(actual).toContain('- Questions')
    expect(actual).toContain('  - should this retry?')
    expect(actual).toContain('- Gates')
    expect(actual).toContain('  - checks: passed')
  },
)

test(
  [
    'given pull-request-body::activitiesSection',
    'when an Activity has no envelope recorded',
    'it should say so rather than inventing an answer',
  ].join(', '),
  () => {
    // given
    const state = aState({ activityRuns: [activityRun()] })
    const facts = aFacts({ state })

    // when
    const actual = activitiesSection(facts)

    // then
    expect(actual).toContain('- Answer: (no envelope recorded)')
  },
)

test(
  [
    'given pull-request-body::activitiesSection',
    'when a Decisions list has more than 5 items',
    'it should cap it at 5 and say how many more there are',
  ].join(', '),
  () => {
    // given
    const decisions = Array.from({ length: 7 }, (_, i) => ({
      decision: `d${i}`,
    }))
    const state = aState({
      activityRuns: [activityRun()],
      envelopes: [envelope({ payload: { decisions } })],
    })
    const facts = aFacts({ state })

    // when
    const actual = activitiesSection(facts)

    // then
    expect(actual.match(/ {2}- d\d/g)?.length).toEqual(MAX_LEDGER_ITEMS)
    expect(actual).toContain('- … and 2 more')
  },
)

test(
  [
    'given pull-request-body::activitiesSection',
    "when an envelope's decisions payload is malformed",
    'it should omit the Decisions group rather than throw',
  ].join(', '),
  () => {
    // given
    const state = aState({
      activityRuns: [activityRun()],
      envelopes: [envelope({ payload: { decisions: 'not an array' } })],
    })
    const facts = aFacts({ state })

    // when
    const actual = () => activitiesSection(facts)

    // then
    expect(actual).not.toThrow()
    expect(actual()).not.toContain('- Decisions')
  },
)

test(
  [
    'given pull-request-body::activitiesSection',
    'when the composing Activity itself appears in the run state',
    'it should exclude that Activity',
  ].join(', '),
  () => {
    // given
    const state = aState({
      activityRuns: [
        activityRun({ name: 'gh-pull-request' }),
        activityRun({ name: 'build', seq: 0 }),
      ],
    })
    const facts = aFacts({ state, composedBy: 'gh-pull-request' })

    // when
    const actual = activitiesSection(facts)

    // then
    expect(actual).not.toContain('### gh-pull-request')
    expect(actual).toContain('### build')
  },
)

test(
  [
    'given pull-request-body::activitiesSection',
    'when the run has no activity runs',
    'it should render nothing',
  ].join(', '),
  () => {
    // given
    const facts = aFacts({ state: aState() })

    // when
    const actual = activitiesSection(facts)

    // then
    expect(actual).toEqual('')
  },
)

// ── '## Checks' ──────────────────────────────────────────────────────────

test(
  [
    'given pull-request-body::checksSection',
    'when a gate recorded a failing check',
    'it should render an unchecked box',
  ].join(', '),
  () => {
    // given
    const state = aState({
      activityRuns: [
        activityRun({
          gates: [
            {
              gate: 'checks',
              activityRun: 'build',
              passed: false,
              violations: ['lint: exited 1'],
              checks: [
                { item: 'lint', ok: false, note: '`biome lint` exited 1' },
              ],
            },
          ],
        }),
      ],
    })
    const facts = aFacts({ state })

    // when
    const actual = checksSection(facts)

    // then
    expect(actual).toContain(
      '- [ ] lint — `biome lint` exited 1 (checks gate, build)',
    )
  },
)

test(
  [
    'given pull-request-body::checksSection',
    'when a declared task never ran',
    'it should render it unchecked and say so',
  ].join(', '),
  () => {
    // given
    const facts = aFacts({
      state: aState(),
      declaredChecks: ['task typecheck'],
    })

    // when
    const actual = checksSection(facts)

    // then
    expect(actual).toContain(
      '- [ ] task typecheck — declared as a task; it did not run in this run',
    )
  },
)

test(
  [
    'given pull-request-body::checksSection',
    'when the same (gate, item) appears in two Activity Runs',
    'it should keep only the highest-seq occurrence',
  ].join(', '),
  () => {
    // given
    const state = aState({
      activityRuns: [
        activityRun({
          seq: 1,
          name: 'build',
          gates: [
            {
              gate: 'checks',
              activityRun: 'build',
              passed: false,
              violations: [],
              checks: [{ item: 'lint', ok: false, note: 'exited 1' }],
            },
          ],
        }),
        activityRun({
          seq: 2,
          name: 'code-review',
          gates: [
            {
              gate: 'checks',
              activityRun: 'code-review',
              passed: true,
              violations: [],
              checks: [{ item: 'lint', ok: true, note: 'exited 0' }],
            },
          ],
        }),
      ],
    })
    const facts = aFacts({ state })

    // when
    const actual = checksSection(facts)

    // then
    const lintLines = actual
      .split('\n')
      .filter((line) => line.includes('] lint —'))
    expect(lintLines.length).toEqual(1)
    expect(lintLines[0]).toContain('[x]')
    expect(lintLines[0]).toContain('code-review')
  },
)

test(
  [
    'given pull-request-body::checksSection',
    'when the working tree has uncommitted paths',
    'it should render an unchecked box naming them',
  ].join(', '),
  () => {
    // given
    const facts = aFacts({ uncommitted: ['runtime/a.ts', 'runtime/b.ts'] })

    // when
    const actual = checksSection(facts)

    // then
    expect(actual).toContain(
      '- [ ] every change committed — 2 path(s) are not in this pull request: runtime/a.ts, runtime/b.ts',
    )
  },
)

test(
  [
    'given pull-request-body::checksSection',
    'when the working tree is clean',
    'it should render a checked box',
  ].join(', '),
  () => {
    // given
    const facts = aFacts({ uncommitted: [] })

    // when
    const actual = checksSection(facts)

    // then
    expect(actual).toContain(
      '- [x] every change committed — nothing uncommitted or untracked',
    )
  },
)

test(
  [
    'given pull-request-body::checksSection',
    'when a gate failed and recorded no per-item checks',
    'it should still render an unchecked line carrying its violations',
  ].join(', '),
  () => {
    // given
    const state = aState({
      activityRuns: [
        activityRun({
          gates: [
            {
              gate: 'diff_matches_claims',
              activityRun: 'build',
              passed: false,
              violations: ['claimed files do not match the diff'],
              checks: [],
            },
          ],
        }),
      ],
    })
    const facts = aFacts({ state })

    // when
    const actual = checksSection(facts)

    // then
    expect(actual).toContain(
      '- [ ] diff_matches_claims — claimed files do not match the diff',
    )
  },
)

test(
  [
    'given a failed check followed by a passing check in one Activity Run',
    'when rendering the delivered checks',
    'it should retain only the later passing verdict at equal sequence',
  ].join(', '),
  () => {
    // given
    const state = aState({
      activityRuns: [
        activityRun({
          gates: [
            {
              gate: 'artifacts_exist',
              activityRun: 'build',
              passed: false,
              violations: ['missing'],
              checks: [{ item: 'artifact.md', ok: false, note: 'missing' }],
            },
            {
              gate: 'artifacts_exist',
              activityRun: 'build',
              passed: true,
              violations: [],
              checks: [{ item: 'artifact.md', ok: true, note: 'exists' }],
            },
          ],
        }),
      ],
    })
    // when
    const actual = checksSection(aFacts({ state }))
    // then
    expect(actual).toContain(
      '- [x] artifact.md — exists (artifacts_exist gate, build)',
    )
    expect(actual).not.toContain('- [ ] artifact.md')
    expect(actual.match(/artifact\.md/g)).toHaveLength(1)
  },
)

// ── body assembly ────────────────────────────────────────────────────────

test(
  [
    'given pull-request-body::agentProse',
    "when the agent's body carries its own issue line and a '## Checks' section",
    'it should discard both',
  ].join(', '),
  () => {
    // given
    const body = [
      '## What changed',
      '',
      'closes #54',
      '',
      'Did the thing.',
      '',
      '## Checks',
      '',
      '- [x] made something up',
      '',
      '## Out of scope',
      '',
      'Nothing.',
    ].join('\n')

    // when
    const actual = agentProse(body)

    // then
    expect(actual).not.toMatch(/closes #54/)
    expect(actual).not.toContain('## Checks')
    expect(actual).not.toContain('made something up')
    expect(actual).toContain('## Out of scope')
    expect(actual).toContain('Did the thing.')
  },
)

test(
  [
    'given pull-request-body::composedBody',
    "when the agent's body has an '## Out of scope' heading",
    'it should insert the harness sections immediately before it',
  ].join(', '),
  () => {
    // given
    const body = [
      '## What changed',
      '',
      'Did the thing.',
      '',
      '## Out of scope',
      '',
      'Nothing.',
    ].join('\n')
    const state = aState({ activityRuns: [activityRun()] })
    const facts = aFacts({ prompt: 'closes #54', state })

    // when
    const actual = composedBody(body, facts)

    // then
    const activitiesIndex = actual.indexOf('## Activities')
    const checksIndex = actual.indexOf('## Checks')
    const outOfScopeIndex = actual.indexOf('## Out of scope')
    expect(actual.startsWith('closes #54')).toBe(true)
    expect(activitiesIndex).toBeGreaterThan(0)
    expect(checksIndex).toBeGreaterThan(activitiesIndex)
    expect(outOfScopeIndex).toBeGreaterThan(checksIndex)
  },
)

test(
  [
    'given pull-request-body::composedBody',
    "when the agent's body has no '## Out of scope' heading",
    'it should append the harness sections at the end',
  ].join(', '),
  () => {
    // given
    const body = ['## What changed', '', 'Did the thing.'].join('\n')
    const facts = aFacts()

    // when
    const actual = composedBody(body, facts)

    // then
    const changedIndex = actual.indexOf('Did the thing.')
    const checksIndex = actual.indexOf('## Checks')
    expect(checksIndex).toBeGreaterThan(changedIndex)
  },
)

test(
  [
    'given pull-request-body::composedBody',
    'when no issue is referenced',
    'it should add no issue line',
  ].join(', '),
  () => {
    // given
    const body = '## What changed\n\nDid the thing.'
    const facts = aFacts()

    // when
    const actual = composedBody(body, facts)

    // then
    expect(actual.startsWith('## What changed')).toBe(true)
  },
)
