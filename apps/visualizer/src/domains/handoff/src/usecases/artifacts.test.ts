import { expect, test } from 'bun:test'
import type { EventRow } from '@/domains/events'
import type { Envelope, HandoffFile } from '../typedefs/handoff'
import {
  activityRunArtifacts,
  artifactViolations,
  relativeToSession,
  runArtifacts,
} from './artifacts'

const RUN = 'c35f2c7d'
const DIR = `/repo/.pi-crust/data/sessions/${RUN}/context_handoff`

const envelope = (
  agent: string,
  activityRunId: string,
  payload: Readonly<Record<string, unknown>>,
  valid = 1,
): Envelope =>
  ({
    envelope_id: `${activityRunId}_${agent}`,
    run_id: RUN,
    activity_run_id: activityRunId,
    agent,
    output_type: 'Output',
    payload_json: JSON.stringify(payload),
    valid,
    created_at: '2026-10-06T00:00:00Z',
  }) as Envelope

const file = (path: string, title = ''): HandoffFile => ({
  path,
  bytes: 10,
  modified_at: '2026-10-06T00:00:00Z',
  title,
})

const artifactEvent = (
  activityRunId: string,
  payload: Readonly<Record<string, unknown>>,
): EventRow =>
  ({
    rowid: 1,
    event_id: `evt_${activityRunId}`,
    run_id: RUN,
    activity_run_id: activityRunId,
    parent_id: null,
    type: 'artifacts',
    name: 'design',
    payload_json: JSON.stringify(payload),
    tokens: null,
    started_at: null,
    ended_at: null,
  }) as EventRow

test(
  [
    'given lib/artifacts::runArtifacts',
    'when a activity reported a document that exists',
    'it should carry the agent, the summary and the heading as its title',
  ].join(', '),
  () => {
    // given — the summary is the whole reason for a card per file: it is what
    // turns a filename into something a reader can decide whether to open
    const envelopes = [
      envelope('technical-architect', `${RUN}_05_design`, {
        artifacts: [`${DIR}/design.md`],
        summary: 'Physical shape for the accepted architecture.',
        notes_for_next_agent: 'The builder must not invent the table names.',
      }),
    ]

    // when
    const actual = runArtifacts({
      runId: RUN,
      envelopes,
      events: [],
      present: [file('context_handoff/design.md', 'Design — ActivityRun 1')],
    })

    // then
    expect(actual).toEqual([
      {
        path: 'context_handoff/design.md',
        name: 'design.md',
        title: 'Design — ActivityRun 1',
        source: 'reported',
        activityRunId: `${RUN}_05_design`,
        agent: 'technical-architect',
        summary: 'Physical shape for the accepted architecture.',
        notes: 'The builder must not invent the table names.',
      },
    ])
  },
)

test(
  [
    'given lib/artifacts::runArtifacts',
    'when a activity claims a document that is not on disk',
    'it should list it as missing rather than hide it',
  ].join(', '),
  () => {
    // given — artifacts is self-reported and nothing checks it. A claim with
    // no file is a defect in the run, and hiding it is the one thing worse
    // than showing it.
    const envelopes = [
      envelope('planner', `${RUN}_02_plan`, {
        artifacts: [`${DIR}/plan.md`],
        summary: 'The plan.',
      }),
    ]

    // when
    const actual = runArtifacts({
      runId: RUN,
      envelopes,
      events: [],
      present: [],
    })

    // then
    expect(actual.map((entry) => [entry.path, entry.source])).toEqual([
      ['context_handoff/plan.md', 'missing'],
    ])
  },
)

test(
  [
    'given lib/artifacts::runArtifacts',
    'when the directory has not been listed yet',
    'it should not call a reported document missing',
  ].join(', '),
  () => {
    // given — not knowing is not the same as knowing it is absent, and the
    // first render happens before the listing arrives
    const envelopes = [
      envelope('planner', `${RUN}_02_plan`, { artifacts: [`${DIR}/plan.md`] }),
    ]

    // when
    const actual = runArtifacts({
      runId: RUN,
      envelopes,
      events: [],
      present: undefined,
    })

    // then
    expect(actual.map((entry) => entry.source)).toEqual(['reported'])
  },
)

test(
  [
    'given lib/artifacts::runArtifacts',
    'when a document on disk was never reported',
    'it should still be listed, and system files marked as such',
  ].join(', '),
  () => {
    // given — over-reporting is deliberate: a document a activity forgot to
    // report is still a document somebody would go hunting for. The run's
    // own machinery files are listed too, but marked, so a reader never has
    // to know which files the interface special-cases.
    const events = [
      artifactEvent(`${RUN}_07_diagnose`, { created: ['diagnosis.md'] }),
    ]

    // when
    const actual = runArtifacts({
      runId: RUN,
      envelopes: [],
      events,
      present: [
        file('context_handoff/diagnosis.md', 'Diagnosis'),
        file('context_handoff/decision-request.md', 'Waiting for you'),
        file('context_handoff/answers-identify.md'),
      ],
    })

    // then — and the unreported document is still attributed to the activityRun
    // that was OBSERVED to create it
    expect(
      actual.map((entry) => [entry.name, entry.source, entry.activityRunId]),
    ).toEqual([
      ['diagnosis.md', 'observed', `${RUN}_07_diagnose`],
      ['decision-request.md', 'system', undefined],
      ['answers-identify.md', 'system', undefined],
    ])
  },
)

test(
  [
    'given lib/artifacts::runArtifacts',
    'when a document is both reported and on disk',
    'it should appear once, keeping what the envelope knows',
  ].join(', '),
  () => {
    // given — both sources describe the same file, and a reader should see
    // one card, not two
    const envelopes = [
      envelope('scout', `${RUN}_01_scout`, {
        artifacts: [`${DIR}/scout_findings.md`],
        summary: 'What the codebase actually does.',
      }),
    ]

    // when
    const actual = runArtifacts({
      runId: RUN,
      envelopes,
      events: [],
      present: [file('context_handoff/scout_findings.md', 'Scout Findings')],
    })

    // then
    expect(actual).toHaveLength(1)
    expect(actual[0]?.summary).toEqual('What the codebase actually does.')
  },
)

test(
  [
    'given lib/artifacts::runArtifacts',
    'when an envelope failed validation',
    'it should not be a source of documents',
  ].join(', '),
  () => {
    // given — an invalid envelope is a rejected report; the attempt that
    // replaced it is the one that speaks for the activity
    const envelopes = [
      envelope(
        'scout',
        `${RUN}_01_scout`,
        { artifacts: [`${DIR}/junk.md`] },
        0,
      ),
    ]

    // when
    const actual = runArtifacts({
      runId: RUN,
      envelopes,
      events: [],
      present: [],
    })

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given lib/artifacts::artifactViolations',
    'when a activityRun changed or removed another activityRun\u2019s document',
    'it should report it, and say nothing about a activityRun that only created',
  ].join(', '),
  () => {
    // given — nothing forbids this today: the handoff directory is granted to
    // every agent wholesale, and being gitignored it is invisible to the
    // permission check that would otherwise catch it
    const events = [
      artifactEvent(`${RUN}_05_design`, { created: ['design.md'] }),
      artifactEvent(`${RUN}_06_build`, {
        created: [],
        modified: ['design.md'],
        deleted: ['plan.md'],
      }),
    ]

    // when
    const actual = artifactViolations(events)

    // then
    expect(actual).toEqual([
      {
        activityRunId: `${RUN}_06_build`,
        modified: ['design.md'],
        deleted: ['plan.md'],
      },
    ])
  },
)

test(
  [
    'given lib/artifacts::relativeToSession and activityRunArtifacts',
    'when a path is absolute and a list spans several activity-run',
    'it should shorten the path and narrow the list to one activity',
  ].join(', '),
  () => {
    // given — the trace stores absolute paths, which are unreadable on a card
    const absolute = `${DIR}/design.md`
    const all = runArtifacts({
      runId: RUN,
      envelopes: [
        envelope('a', `${RUN}_01_one`, { artifacts: [`${DIR}/one.md`] }),
        envelope('b', `${RUN}_02_two`, { artifacts: [`${DIR}/two.md`] }),
      ],
      events: [],
      present: undefined,
    })

    // when
    const actual = [
      relativeToSession(absolute, RUN),
      ...activityRunArtifacts(all, `${RUN}_02_two`).map((entry) => entry.name),
    ]

    // then
    expect(actual).toEqual(['context_handoff/design.md', 'two.md'])
  },
)

test(
  [
    'given lib/artifacts::relativeToSession and runArtifacts',
    'when a --handoff relocated the directory outside sessions/<run>/',
    'it should collapse a reported artifact onto the same context_handoff/<name> key the observed listing uses',
  ].join(', '),
  () => {
    // given — a relocated handoff directory never matches /sessions/<run>/,
    // so without the handoffDir fallback this would render two cards
    const relocatedDir = '/repo/specs/c35f2c7d'
    const absolute = `${relocatedDir}/plan.md`

    // when
    const actual = relativeToSession(absolute, RUN, relocatedDir)

    // then
    expect(actual).toEqual('context_handoff/plan.md')
  },
)

test(
  [
    'given lib/artifacts::runArtifacts',
    'when a reported artifact is inside a relocated handoff directory, and the same file is also observed',
    'it should produce exactly one artifact, not two',
  ].join(', '),
  () => {
    // given
    const relocatedDir = '/repo/specs/c35f2c7d'
    const path = `${relocatedDir}/plan.md`

    // when
    const actual = runArtifacts({
      runId: RUN,
      handoffDir: relocatedDir,
      envelopes: [envelope('a', `${RUN}_01_plan`, { artifacts: [path] })],
      events: [],
      present: [
        {
          path: 'context_handoff/plan.md',
          title: '',
          bytes: 0,
          modified_at: '',
        },
      ],
    })

    // then
    expect(actual).toHaveLength(1)
    expect(actual[0]?.path).toEqual('context_handoff/plan.md')
    expect(actual[0]?.source).toEqual('reported')
  },
)

test(
  [
    'given lib/artifacts::relativeToSession',
    'when the path matches neither the session marker nor a handoff directory',
    'it should return the path unchanged',
  ].join(', '),
  () => {
    // given — a path from an entirely different tree
    const path = '/elsewhere/not-this-run/design.md'

    // when
    const actual = relativeToSession(path, RUN, '/repo/specs/other-run')

    // then
    expect(actual).toEqual(path)
  },
)

test(
  [
    'given lib/artifacts::runArtifacts',
    'when a reported envelope carries malformed payload JSON',
    'it should not throw, and should report no artifacts for that envelope',
  ].join(', '),
  () => {
    // given
    const broken: Envelope = {
      ...envelope('a', `${RUN}_01_plan`, {}),
      payload_json: 'not json',
    }

    // when
    const actual = runArtifacts({
      runId: RUN,
      envelopes: [broken],
      events: [],
      present: undefined,
    })

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given lib/artifacts::runArtifacts',
    'when an artifacts event carries malformed payload JSON',
    'it should not throw, and should not attribute the observed file to any activityRun',
  ].join(', '),
  () => {
    // given
    const broken: EventRow = {
      ...artifactEvent(`${RUN}_01_plan`, {}),
      payload_json: 'not json',
    }

    // when
    const actual = runArtifacts({
      runId: RUN,
      envelopes: [],
      events: [broken],
      present: [file(`${DIR}/plan.md`)],
    })

    // then
    expect(actual[0]?.activityRunId).toBeUndefined()
  },
)

for (const path of [
  '/data/sessions/owner/repo/id/context_handoff/plan.md',
  '/data/sessions/group/subgroup/project/id/context_handoff/plan.md',
  '/data/sessions/id/context_handoff/plan.md',
]) {
  test(
    [
      `given a reported artifact in ${path}`,
      'when resolving its session-relative name',
      'it should use the same key as the handoff listing',
    ].join(', '),
    () => {
      // given
      // when
      const actual = relativeToSession(path, 'id')
      // then
      expect(actual).toBe('context_handoff/plan.md')
    },
  )
}
