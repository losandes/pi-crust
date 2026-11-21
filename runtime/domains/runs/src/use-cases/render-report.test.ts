import { expect, test } from 'bun:test'
import type { TRunState } from '../../../../lib/contracts'
import { importOutputSchema } from '../../../../lib/contracts'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import { renderReport, resumeCommand } from '../..'

const aState = (overrides: Readonly<Partial<TRunState>> = {}): TRunState =>
  ({
    run_id: 'fbf49583',
    lifecycle: 'sdlc',
    name: '',
    request: 'add a /health endpoint',
    status: 'fail',
    engineer: 'tester',
    started_at: undefined,
    ended_at: undefined,
    tokens: 0,
    cost: 0,
    activityRuns: [],
    completed: [],
    resume_from: undefined,
    resumable: true,
    failed_gates: [],
    warnings: [],
    envelopes: [],
    ...overrides,
  }) as TRunState

test(
  [
    'given SC7 and SC19 an ImportOutput with versions and comments',
    'when rendering the operator report',
    'it should show provenance and ignore invalid later records',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const payload = importOutputSchema.parse({
        status: 'success',
        source: {
          kind: 'github-issue',
          written: '#150',
          address: 'issue-address',
          read_at: 'read-time',
          updated_at: 'issue-updated',
        },
        documents: [
          {
            activity: 'plan',
            document: 'handoff/plan.md',
            status: 'imported',
            address: 'comment-address',
            versions: [
              {
                address: 'issue-address',
                posted_at: 'issue-posted',
                used: false,
              },
              {
                address: 'comment-address',
                posted_at: 'plan-posted',
                used: true,
              },
            ],
            appended: ['answer-address'],
          },
        ],
        comments: [
          {
            author: 'alice',
            association: 'MEMBER',
            address: 'comment-address',
            posted_at: 'plan-posted',
            edited_at: 'plan-edited',
            placement: 'yielded',
            documents: ['handoff/plan.md'],
            reason: '',
          },
          {
            author: 'bob',
            association: 'OWNER',
            address: 'answer-address',
            posted_at: 'answer-posted',
            edited_at: 'answer-edited',
            placement: 'appended',
            documents: ['handoff/plan.md'],
            reason: '',
          },
        ],
        unattributed: [
          { address: 'issue-address', label: 'Plan', reason: 'superseded' },
        ],
      })
      const state = aState({
        envelopes: [
          {
            activityRun: 'import',
            agent: 'import',
            output_type: 'ImportOutput',
            valid: true,
            payload,
          },
          {
            activityRun: 'import',
            agent: 'import',
            output_type: 'ImportOutput',
            valid: true,
            payload: {},
          },
          {
            activityRun: 'import',
            agent: 'import',
            output_type: 'ImportOutput',
            valid: false,
            payload: {
              ...payload,
              source: { ...payload.source, written: 'invalid' },
            },
          },
        ],
      })
      // when
      const actual = renderReport(state)
      // then
      for (const field of [
        '#150',
        'issue-address',
        'read-time',
        'issue-updated',
        'handoff/plan.md',
        'imported',
        'comment-address',
        'issue-posted',
        'plan-posted',
        'plan-edited',
        'alice',
        'bob',
        'answer-address',
        'answer-posted',
        'answer-edited',
        'yielded',
        'appended',
        'superseded',
      ])
        expect(actual).toContain(field)
      expect(actual).not.toContain('import invalid')
      expect(renderReport(aState())).not.toContain('import #150')
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given report::resumeCommand',
    'when a recorded invocation exists',
    'it should replay it through resumeArgv rather than reconstruct from the request',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const state = aState()
      const invocation = [
        'bun',
        'runtime/compose.ts',
        'add a /health endpoint',
        '--run-id',
        'fbf49583',
      ]

      // when
      const actual = resumeCommand(state, invocation)

      // then
      expect(actual).toContain('--resume')
      expect(actual).toContain('fbf49583')
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given report::resumeCommand',
    'when no invocation was recorded',
    'it should reconstruct a command from the request',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const state = aState()

      // when
      const actual = resumeCommand(state, undefined)

      // then
      expect(actual).toContain('add a /health endpoint')
      expect(actual).toContain('--run-id')
      expect(actual).toContain('--resume')
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given report::renderReport',
    'when an activityRun failed one of its gates',
    'it should print the gate name and every violation under it',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const state = aState({
        status: 'fail',
        resumable: true,
        resume_from: 'build',
        activityRuns: [
          {
            activity_run_id: 'fbf49583_01_build',
            seq: 1,
            name: 'build',
            kind: 'code',
            owner: 'quality',
            status: 'fail',
            error: undefined,
            gates: [
              {
                gate: 'checks',
                passed: false,
                violations: ['lint failed on src/a.ts'],
              },
            ],
          },
        ] as unknown as TRunState['activityRuns'],
      })

      // when
      const actual = renderReport(state)

      // then
      expect(actual).toContain('gate checks failed')
      expect(actual).toContain('lint failed on src/a.ts')
      expect(actual).toContain('resume from:')
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given report::renderReport',
    'when the run filed a warning',
    'it should print it, highlighted the same way the terminal that ran it did',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const state = aState({
        warnings: [
          {
            kind: 'outside_workspace',
            activities: ['build'],
            activityRunIds: ['fbf49583_01_build'],
            stage: 'build',
            paths: ['../shared/lockfile.txt'],
            note: 'resolved against the VCS root, not the workspace',
          },
        ] as unknown as TRunState['warnings'],
      })

      // when
      const actual = renderReport(state)

      // then
      expect(actual).toContain('lockfile.txt')
    } finally {
      restoreTerminal()
    }
  },
)
