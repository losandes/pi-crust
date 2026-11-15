import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const readPrompt = (activity: string, filename: string): string =>
  readFileSync(join(import.meta.dir, activity, filename), 'utf8')

const reportExample = (text: string): string =>
  text.split('\n## Report\n')[1]?.match(/```json\n([\s\S]*?)```/)?.[1] ?? ''

for (const { activity, requirement, expected } of [
  {
    activity: 'build',
    requirement: '1.1.1 changed_files',
    expected:
      '  "changed_files": ["<a path you changed>", "<another, or fewer>"],',
  },
  {
    activity: 'build',
    requirement: '1.1.1 disputes',
    expected:
      '      "evidence": "<path:line> — the guard the review says is missing",',
  },
  {
    activity: 'code-review',
    requirement: '1.1.2',
    expected:
      '    { "requirement": "<the convention, as the record states it>", "met": true, "evidence": "<path:line> — settles rather than throws" }',
  },
  {
    activity: 'outcome-review',
    requirement: '1.1.3',
    expected:
      '    { "requirement": "<the ask, in the requester\'s words>", "met": true, "evidence": "<path:line> — handler registered" }',
  },
  {
    activity: 'document',
    requirement: '1.1.4',
    expected: '  "documented_files": ["<a path the diff touched>"],',
  },
  {
    activity: 'scout',
    requirement: '1.1.5',
    expected:
      '    { "file": "<a path that matters>", "note": "<why this file matters>" }',
  },
  {
    activity: 'test',
    requirement: '1.1.6',
    expected: '  "changed_files": ["<the test file you wrote>"],',
  },
]) {
  test(
    [
      `given ${activity}/user.md's Report example (#110 ${requirement})`,
      'when an agent reads the illustrated path or evidence field',
      'it should use the canonical angle-bracket placeholder without losing the example format (1.1.7–1.1.8)',
    ].join(', '),
    () => {
      // given
      const prompt = readPrompt(activity, 'user.md')

      // when
      const actual = reportExample(prompt).split('\n')

      // then
      expect(actual).toContain(expected)
    },
  )
}

const CONTEXT_FIELDS = [
  'facts',
  'decisions',
  'assumptions',
  'unresolved',
  'risks',
  'regress_to',
]

const BUILD_FIELDS = [
  'objective_met',
  'status',
  'summary',
  'changed_files',
  'artifacts',
  'disputes',
  'commit_message',
  'notes_for_next_agent',
]

const REVIEW_FIELDS = [
  'objective_met',
  'status',
  'approved',
  'summary',
  'findings',
  'blocking',
  'artifacts',
  'notes_for_next_agent',
]

for (const { activity, fields } of [
  { activity: 'build', fields: BUILD_FIELDS },
  { activity: 'code-review', fields: REVIEW_FIELDS },
  { activity: 'outcome-review', fields: REVIEW_FIELDS },
  {
    activity: 'document',
    fields: [
      'objective_met',
      'status',
      'summary',
      'document_path',
      'documented_files',
      'artifacts',
      'commit_message',
      'notes_for_next_agent',
    ],
  },
  {
    activity: 'scout',
    fields: ['objective_met', 'status', 'summary', 'findings', 'artifacts'],
  },
  { activity: 'test', fields: BUILD_FIELDS },
]) {
  test(
    [
      `given ${activity}/user.md after its path examples are generalized (#110 1.1.9)`,
      'when its Report example is parsed',
      'it should still teach every pre-existing envelope field in order',
    ].join(', '),
    () => {
      // given
      const example = reportExample(readPrompt(activity, 'user.md'))

      // when
      const actual = Object.keys(JSON.parse(example))

      // then
      expect(actual).toEqual([...CONTEXT_FIELDS, ...fields])
    },
  )
}

for (const activity of [
  'build',
  'code-review',
  'conceptualize',
  'data-research',
  'design',
  'diagnose',
  'document',
  'domain-research',
  'gh-issue',
  'identify',
  'outcome-review',
  'plan',
  'scout',
  'security-research',
  'technical-research',
  'test',
  'ux-design',
  'ux-research',
]) {
  test(
    [
      `given ${activity}/system.md's shell-environment instruction (#110 1.2.1–1.2.2, 1.2.4)`,
      'when an agent reads which tools to call',
      'it should retain bare-name and absolute-path guidance without assuming a language toolchain',
    ].join(', '),
    () => {
      // given
      const tools =
        activity === 'gh-issue'
          ? "`git`, `gh`, and whatever this repository's own toolchain provides"
          : "`git`, and whatever this repository's own toolchain provides"
      const expected = [
        "- You inherit the operator's shell environment — their PATH, toolchains and credentials are already live. ",
        `Call tools by bare name (${tools}); `,
        'never hunt for a binary or fall back to an absolute `/usr/bin/*` path.',
      ].join('')

      // when
      const actual = readPrompt(activity, 'system.md')
        .split('\n')
        .filter((line) =>
          line.startsWith("- You inherit the operator's shell environment"),
        )

      // then
      expect(actual).toEqual([expected])
    },
  )
}

test(
  [
    'given plan/system.md\'s "Make every change provable" instruction (#110 1.2.3–1.2.4)',
    'when the planner reads examples of a command that settles a change',
    "it should use the target repository's test command and type checker without dropping the verification requirements",
  ].join(', '),
  () => {
    // given
    const expected =
      '- **Make every change provable.** Each entry in section 4 names the requirements it satisfies and the one command that settles it: this repository\'s own test command, its type checker, a specific assertion. "Done when the handler is clean" is not evidence; a command with an exit status is. If nothing can settle it, say what would have to exist for it to be checkable.'

    // when
    const actual = readPrompt('plan', 'system.md')
      .split('\n')
      .filter((line) => line.startsWith('- **Make every change provable.**'))

    // then
    expect(actual).toEqual([expected])
  },
)
