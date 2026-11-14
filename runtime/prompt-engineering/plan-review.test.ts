import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { planOutputSchema, reviewOutputSchema } from '../lib/contracts'

const prompt = (activity: string, part: string): string =>
  readFileSync(join(import.meta.dir, activity, `${part}.md`), 'utf8')

for (const activity of ['plan-comprehension', 'plan-readiness']) {
  test(
    [
      `given prompt-engineering/${activity}`,
      'when its instructions and Report are read',
      'it should grade findings without making severity a second blocking authority',
    ].join(', '),
    () => {
      // given
      const system = prompt(activity, 'system')
      const user = prompt(activity, 'user')
      const example = user.match(/```json\n([\s\S]*?)\n```/)?.[1]

      // when
      const report = reviewOutputSchema.parse(JSON.parse(example ?? '{}'))

      // then
      expect(system).toContain('a nit never does')
      expect(system).toContain('Blockers and majors go in `blocking`')
      expect(user).toContain(
        'Give every finding a `severity` of `blocker`, `major` or `nit`',
      )
      expect(user).toContain('The plan is at `{{context_handoff_dir}}/plan.md`')
      expect(user).toContain('{{previous_envelopes}}')
      expect(report.findings[0]?.severity).toBeDefined()
    },
  )
}

test(
  [
    'given the plan comprehension prompts',
    'when a fresh reviewer receives the plan',
    'it should paraphrase it from the document alone and refuse repository access',
  ].join(', '),
  () => {
    // given
    const system = prompt('plan-comprehension', 'system')
    const user = prompt('plan-comprehension', 'user')

    // when, then
    expect(system).toContain('**Do not read the repository.**')
    expect(system).toContain('any path outside the handoff directory')
    expect(user).toContain('## What this plan proposes')
    expect(user).toContain('## How the existing system works, per this plan')
    expect(user).toContain(
      'two to five sentences each, from the plan alone and before any audit',
    )
  },
)

test(
  [
    'given the plan readiness prompts',
    'when a reviewer judges implementation readiness',
    'it should demand settled decisions, literal file boundaries, provable steps and repository evidence',
  ].join(', '),
  () => {
    // given
    const system = prompt('plan-readiness', 'system')

    // when, then
    expect(system).toContain(
      'Block on any step that leaves a design decision to the builder',
    )
    expect(system).toContain(
      'repository-relative paths it expects to be created, modified or deleted',
    )
    expect(system).toContain(
      'Block when a step names no command, test, or observable result',
    )
    expect(system).toContain(
      'Check what the plan asserts about this repository against the repository',
    )
    expect(system).toContain('also cites the `path:line` you read')
  },
)

test(
  [
    'given the plan prompts and PlanOutput contract',
    'when findings return from more than one reviewer',
    'it should show both revision fields and require a rewrite or an evidenced dispute for every blocker',
  ].join(', '),
  () => {
    // given
    const system = prompt('plan', 'system')
    const user = prompt('plan', 'user')
    const example = user.match(/```json\n([\s\S]*?)\n```/)?.[1]

    // when
    const report = planOutputSchema.parse(JSON.parse(example ?? '{}'))

    // then
    expect(system).toContain(
      'A review of your plan is not a request for a new plan',
    )
    expect(user).toContain(
      '## When `previous_envelopes` carries review verdicts',
    )
    expect(user).toContain('Answer every blocking item in all of them')
    expect(user).toContain(
      'Reporting neither a rewritten file nor a dispute fails the gate',
    )
    expect(report.changed_files).toHaveLength(1)
    expect(report.disputes).toHaveLength(1)
    expect(report.disputes[0]?.evidence).toContain('path:line')
  },
)
