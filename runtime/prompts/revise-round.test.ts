import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TUserMessage } from '../domains/activities/src/use-cases/execute-agent'
import {
  findingsBlock,
  userMessage,
} from '../domains/activities/src/use-cases/execute-agent'
import { render, revisePromptPath } from '../domains/agents'
import { buildOutputSchema, planOutputSchema } from '../lib/contracts'

const S_TASK =
  'Your task in this round is to answer the blocking findings listed under `## Blocking findings from review` at the end of these instructions, and nothing else.'
const S_LEAVE =
  'Leave every part of the existing work that no finding names exactly as it is.'
const S_CONFINE =
  'Confine your changes, and the verification you run yourself, to what the findings name and what your changes to them affect.'
const T_SENTENCES = [
  'Test files only — you may not modify implementation code.',
  'Do not weaken, skip or delete a test to make a finding go away.',
  'A finding that can only be answered by changing implementation code is not yours to fix. When no declared check decides it, dispute it, and cite the `path:line` of the implementation code it names as the evidence.',
  'When a declared check does decide it, the instruction "Fix it." in the findings block does not apply to you: do not dispute it and do not change implementation code. Put it in `unresolved` with `consequential: true` and an empty `provisional_answer`, quoting the finding and naming the `path:line` of the implementation code, so that it reaches a person.',
]
const FULL_TASK = {
  build: 'Implement the work described in `prompt`',
  test: 'Write the tests that would prove the work described in `prompt`',
  plan: 'Plan the work described in `prompt`',
} as const
const VARIABLES = {
  prompt: 'SENTINEL_ORIGINAL_TASK',
  previous_envelope: 'SENTINEL_PREVIOUS_ENVELOPE',
  previous_envelopes: 'SENTINEL_PREVIOUS_ENVELOPES',
  context_handoff_dir: 'SENTINEL_HANDOFF',
  output_document: 'SENTINEL_OUTPUT',
  changed_files: 'SENTINEL_CHANGED_FILES',
  change_base: 'SENTINEL_CHANGE_BASE',
  step_catalogue: 'SENTINEL_CATALOGUE',
  trust_stance: 'SENTINEL_TRUST',
}
const FINDINGS = ['SENTINEL_FINDING_ONE', 'SENTINEL_FINDING_TWO']
const messageFor = (activity: keyof typeof FULL_TASK): TUserMessage => ({
  prompts: join(import.meta.dir, activity),
  variables: VARIABLES,
  steering: 'SENTINEL_STEERING',
  feedback: [],
  blockingFindings: FINDINGS,
})
const compose = userMessage({ render, reviseReference: revisePromptPath })
const source = (activity: string, name: string): string =>
  readFileSync(join(import.meta.dir, activity, name), 'utf8')
const section = (text: string, heading: string): string =>
  text.split(`## ${heading}\n\n`)[1]?.split('\n## ')[0] ?? ''
const report = (text: string): string => text.slice(text.indexOf('## Report'))

for (const activity of ['build', 'test', 'plan'] as const) {
  test(
    [
      `given the shipped ${activity} prompts and two review findings`,
      'when composing a revise round',
      'it should send the findings-only task with steering and review attribution',
    ].join(', '),
    () => {
      // given
      const message = messageFor(activity)

      // when
      const actual = compose(message)

      // then
      expect(actual).toContain(S_TASK)
      expect(actual).not.toContain(VARIABLES.prompt)
      expect(actual).not.toContain(FULL_TASK[activity])
      expect(actual).not.toContain('{{')
      expect(actual).toContain(S_LEAVE)
      expect(actual).toContain(S_CONFINE)
      expect(actual).toContain('## Blocking findings from review')
      for (const finding of FINDINGS) expect(actual).toContain(`- ${finding}`)
      expect(actual).not.toContain('## What failed last time')
      expect(actual).not.toContain("rejected by this repository's gates")
      expect(actual).not.toContain('They are checked again')
      expect(actual).toContain(
        "Give every finding exactly one answer: fix it, or dispute it in `disputes` with evidence a third party can re-check. A finding that one of this repository's declared checks decides may not be disputed. Fix it.",
      )
      expect(actual).toContain(message.steering)
      expect(actual).toContain(VARIABLES.previous_envelope)
      expect(actual).toContain(VARIABLES.previous_envelopes)
      expect(actual.endsWith(findingsBlock(FINDINGS))).toBe(true)
    },
  )

  test(
    [
      `given ${activity}/revise.md as written`,
      'when inspecting its sections and report example',
      'it should preserve the intake and report contract without the original task',
    ].join(', '),
    () => {
      // given
      const user = source(activity, 'user.md')
      const build = source('build', 'user.md')
      const revise = source(activity, 'revise.md')
      const expectedVariables = [
        'previous_envelope',
        'previous_envelopes',
        'context_handoff_dir',
      ]
      const expectedReport =
        activity === 'test'
          ? report(user)
              .replace(
                '```json',
                '`disputes` holds one entry per finding you did not fix.\n\n```json',
              )
              .replace(
                '  "disputes": [],',
                build.match(/ {2}"disputes": \[[\s\S]*?\n {2}\],/)?.[0] ?? '',
              )
          : report(user)
      const reviewBody = section(
        activity === 'plan' ? user : build,
        activity === 'plan'
          ? 'When `previous_envelopes` carries review verdicts'
          : 'When `previous_envelope` is a review verdict',
      ).trimEnd()
      const expectedTask = [
        S_TASK,
        S_LEAVE,
        S_CONFINE,
        reviewBody,
        ...(activity === 'test' ? T_SENTENCES : []),
      ].join('\n\n')

      // when
      const headings = revise.match(/^#{1,2} .+$/gm)
      const example = revise.match(/```json\n([\s\S]*?)\n```/)?.[1]
      const parsed = (
        activity === 'plan' ? planOutputSchema : buildOutputSchema
      ).safeParse(JSON.parse(example ?? '{}'))

      // then
      expect(headings).toEqual([
        `# ${activity[0]?.toUpperCase()}${activity.slice(1)} Revise Task`,
        '## Variables',
        '## Intake',
        '## Task',
        '## Report',
      ])
      expect(section(revise, 'Variables').trimEnd()).toBe(
        expectedVariables
          .map((name) => `### ${name}\n\n{{${name}}}`)
          .join('\n\n'),
      )
      expect(revise).not.toContain('{{prompt}}')
      expect(section(revise, 'Intake')).toBe(section(user, 'Intake'))
      expect(section(revise, 'Task').trimEnd()).toBe(expectedTask)
      expect(report(revise)).toBe(expectedReport)
      expect(parsed.success).toBe(true)
      for (const sentence of activity === 'test' ? T_SENTENCES : [])
        expect(revise).toContain(sentence)
    },
  )
}

for (const feedback of [[], ['suite: exit 1']]) {
  test(
    [
      `given build with no findings and ${feedback.length} gate violations`,
      'when composing its user message',
      'it should preserve the full task and append only gate feedback when present',
    ].join(', '),
    () => {
      // given
      const message = { ...messageFor('build'), feedback, blockingFindings: [] }

      // when
      const actual = compose(message)

      // then
      expect(actual).toContain(FULL_TASK.build)
      expect(actual).toContain(VARIABLES.prompt)
      expect(actual).toContain(message.steering)
      expect(actual).not.toContain('## Blocking findings from review')
      if (feedback.length === 0)
        expect(actual).not.toContain('## What failed last time')
      else {
        expect(actual).toContain('## What failed last time')
        expect(actual).toContain("rejected by this repository's gates")
        expect(actual).toContain(
          'They are checked again, the same way, when you are done.',
        )
        expect(actual).toContain('- suite: exit 1')
      }
    },
  )
}

test(
  [
    'given a revise attempt rejected by a gate',
    'when both feedback and review findings are present',
    'it should send exactly the ordinary gate-retry message',
  ].join(', '),
  () => {
    // given
    const message = { ...messageFor('build'), feedback: ['suite: exit 1'] }

    // when
    const actual = compose(message)

    // then
    expect(actual).toBe(compose({ ...message, blockingFindings: [] }))
  },
)
