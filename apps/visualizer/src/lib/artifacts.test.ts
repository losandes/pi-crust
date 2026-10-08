import { expect, test } from 'bun:test'
import {
  artifactViolations,
  phaseArtifacts,
  relativeToSession,
  runArtifacts,
} from './artifacts'
import type { Envelope, EventRow, HandoffFile } from './types'

const RUN = 'c35f2c7d'
const DIR = `/repo/.pi-crust/data/sessions/${RUN}/context_handoff`

const envelope = (
  agent: string,
  phaseId: string,
  payload: Readonly<Record<string, unknown>>,
  valid = 1,
): Envelope =>
  ({
    envelope_id: `${phaseId}_${agent}`,
    run_id: RUN,
    phase_id: phaseId,
    agent,
    output_type: 'Output',
    payload_json: JSON.stringify(payload),
    valid,
    attempt: 1,
    created_at: '2026-10-06T00:00:00Z',
  }) as Envelope

const file = (path: string, title = ''): HandoffFile => ({
  path,
  bytes: 10,
  modified_at: '2026-10-06T00:00:00Z',
  title,
})

const artifactEvent = (
  phaseId: string,
  payload: Readonly<Record<string, unknown>>,
): EventRow =>
  ({
    rowid: 1,
    event_id: `evt_${phaseId}`,
    run_id: RUN,
    phase_id: phaseId,
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
    'when a step reported a document that exists',
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
      present: [file('context_handoff/design.md', 'Design — Phase 1')],
    })

    // then
    expect(actual).toEqual([
      {
        path: 'context_handoff/design.md',
        name: 'design.md',
        title: 'Design — Phase 1',
        source: 'reported',
        phaseId: `${RUN}_05_design`,
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
    'when a step claims a document that is not on disk',
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
    // given — over-reporting is deliberate: a document a step forgot to
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

    // then — and the unreported document is still attributed to the phase
    // that was OBSERVED to create it
    expect(
      actual.map((entry) => [entry.name, entry.source, entry.phaseId]),
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
    // replaced it is the one that speaks for the step
    const envelopes = [
      envelope('scout', `${RUN}_01_scout`, { artifacts: [`${DIR}/junk.md`] }, 0),
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
    'when a phase changed or removed another phase\u2019s document',
    'it should report it, and say nothing about a phase that only created',
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
        phaseId: `${RUN}_06_build`,
        modified: ['design.md'],
        deleted: ['plan.md'],
      },
    ])
  },
)

test(
  [
    'given lib/artifacts::relativeToSession and phaseArtifacts',
    'when a path is absolute and a list spans several phases',
    'it should shorten the path and narrow the list to one step',
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
      ...phaseArtifacts(all, `${RUN}_02_two`).map((entry) => entry.name),
    ]

    // then
    expect(actual).toEqual(['context_handoff/design.md', 'two.md'])
  },
)
