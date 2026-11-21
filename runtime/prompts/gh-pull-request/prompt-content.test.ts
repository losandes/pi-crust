/**
 * Independent coverage of issue #58's requirements on the `gh-pull-request`
 * prompts themselves (1.2.1, 1.7.1–1.7.5). No other test file reads these
 * markdown files — `pull-request-body.test.ts` and `gh-pull-request.test.ts`
 * exercise the harness's own rendering, not what the agent is told. These
 * assertions are the behavioural contract the harness depends on the agent
 * honouring: that it has been told the harness owns the issue link and the
 * `## Activities`/`## Checks` sections, that lobbying language is
 * forbidden, and that the pre-existing instructions the plan requires to
 * survive (no attribution line, no envelope JSON, no git/`gh` command,
 * `read`-only) still do.
 */

import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PROMPT_DIR = join(__dirname)
const systemMd = (): string =>
  readFileSync(join(PROMPT_DIR, 'system.md'), 'utf8')
const userMd = (): string => readFileSync(join(PROMPT_DIR, 'user.md'), 'utf8')

test(
  [
    'given prompts/gh-pull-request/system.md',
    'when read',
    'it should forbid arguing the change is safe, ready, or should be merged (1.2.1)',
  ].join(', '),
  () => {
    // given / when
    const actual = systemMd()

    // then
    expect(actual).toMatch(/never argue/i)
    expect(actual).toMatch(/safe, ready, or should be merged/i)
  },
)

test(
  [
    'given prompts/gh-pull-request/system.md',
    'when read',
    'it should tell the agent the harness owns the issue link and the Activities and Checks sections (1.7.2)',
  ].join(', '),
  () => {
    // given / when
    const actual = systemMd()

    // then
    expect(actual).toMatch(/harness[^.]*owns[^.]*issue link/i)
    expect(actual).toContain('## Activities')
    expect(actual).toContain('## Checks')
    expect(actual).toMatch(/discarded/i)
  },
)

test(
  [
    'given prompts/gh-pull-request/system.md',
    'when read',
    'it should preserve the pre-existing no-attribution, no-envelope-JSON, no-git/gh, and read-only instructions (1.7.5)',
  ].join(', '),
  () => {
    // given / when
    const actual = systemMd()

    // then
    expect(actual).toMatch(/attribution/i)
    expect(actual).toMatch(/envelope JSON/i)
    expect(actual).toMatch(/no `bash`/i)
    expect(actual).toMatch(/git or `gh` command/i)
  },
)

test(
  [
    'given prompts/gh-pull-request/user.md',
    'when read',
    'it should tell the agent not to put an issue number in the title (1.7.4)',
  ].join(', '),
  () => {
    // given / when
    const actual = userMd()

    // then
    expect(actual).toMatch(
      /not.*issue number.*title|title.*not.*issue number/is,
    )
  },
)

test(
  [
    'given prompts/gh-pull-request/user.md',
    'when read',
    "it should tell the agent to write outcome-level '## What changed' bullets, not file-by-file or line-level mechanics (1.7.3)",
  ].join(', '),
  () => {
    // given / when
    const actual = userMd()

    // then
    expect(actual).toContain('## What changed')
    expect(actual).toMatch(/outcome-level/i)
    expect(actual).toMatch(/file-by-file|line-level/i)
  },
)

test(
  [
    'given prompts/gh-pull-request/user.md',
    'when read',
    'it should tell the agent the harness owns the issue link, Activities and Checks and discards anything it writes there (1.7.2)',
  ].join(', '),
  () => {
    // given / when
    const actual = userMd()

    // then
    expect(actual).toMatch(/harness owns the issue link/i)
    expect(actual).toMatch(/discards/i)
    expect(actual).toMatch(/never argue/i)
  },
)
