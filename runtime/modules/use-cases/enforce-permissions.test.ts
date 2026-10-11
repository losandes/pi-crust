import { expect, test } from 'bun:test'
import type { TAgentConfig, TPiCrustConfig } from '../typedefs/config'
import { crustConfigSchema } from '../typedefs/config'
import {
  changedPaths,
  handoffDocument,
  matchesPattern,
  permitted,
  resolveWrites,
} from './enforce-permissions'

const configWith = (
  agents: ReadonlyArray<Partial<TAgentConfig> & Readonly<{ name: string }>>,
): TPiCrustConfig =>
  crustConfigSchema.parse({
    defaults: {
      protected_files: [
        '.pi-crust/modules/',
        '.pi-crust/config/',
        '.pi-crust/stages/*.ts',
      ],
      data_dir: '.pi-crust/data',
    },
    agents: agents.map((agent) => ({
      prompt_engineering: { system: 's.md', user: 'u.md' },
      ...agent,
    })),
  })

const agentNamed = (cfg: TPiCrustConfig, name: string): TAgentConfig => {
  const agent = cfg.agents.find((candidate) => candidate.name === name)
  if (agent === undefined) {
    throw new Error(`test fixture has no agent ${name}`)
  }
  return agent
}

test(
  [
    'given use-cases/enforce-permissions::matchesPattern',
    'when the pattern uses a single star',
    'it should match within one segment and not across a slash',
  ].join(', '),
  () => {
    // given
    const pattern = '.pi-crust/stages/*.ts'

    // when
    const withinSegment = matchesPattern('.pi-crust/stages/plan.ts', pattern)
    const acrossSlash = matchesPattern(
      '.pi-crust/stages/nested/plan.ts',
      pattern,
    )

    // then
    expect(withinSegment).toEqual(true)
    expect(acrossSlash).toEqual(false)
  },
)

test(
  [
    'given use-cases/enforce-permissions::matchesPattern',
    'when the pattern uses a double star',
    'it should cross path separators',
  ].join(', '),
  () => {
    // given
    const pattern = '**/*.md'

    // when
    const actual = matchesPattern('docs/deep/nested/readme.md', pattern)

    // then
    expect(actual).toEqual(true)
  },
)

test(
  [
    'given use-cases/enforce-permissions::matchesPattern',
    'when the pattern ends in a slash',
    'it should be treated as a directory prefix',
  ].join(', '),
  () => {
    // given
    const pattern = 'specs/'

    // when
    const inside = matchesPattern('specs/a/b/c.md', pattern)
    const sibling = matchesPattern('specifications/a.md', pattern)

    // then
    expect(inside).toEqual(true)
    expect(sibling).toEqual(false)
  },
)

test(
  [
    'given use-cases/enforce-permissions::permitted',
    'when a read-only agent targets the session runtime',
    'it should be allowed to write its own report',
  ].join(', '),
  () => {
    // given
    const cfg = configWith([{ name: 'scout', writes: [] }])

    // when
    const actual = permitted(
      '.pi-crust/data/sessions/abc/context_handoff/findings.md',
      agentNamed(cfg, 'scout'),
      cfg,
    )

    // then
    expect(actual).toEqual(true)
  },
)

test(
  [
    'given use-cases/enforce-permissions::permitted',
    'when a read-only agent targets a repo file',
    'it should be refused',
  ].join(', '),
  () => {
    // given
    const cfg = configWith([{ name: 'scout', writes: [] }])

    // when
    const actual = permitted('src/server.ts', agentNamed(cfg, 'scout'), cfg)

    // then
    expect(actual).toEqual(false)
  },
)

test(
  [
    'given use-cases/enforce-permissions::permitted',
    'when an unrestricted agent targets a protected path',
    'it should be refused because it never named it',
  ].join(', '),
  () => {
    // given
    const cfg = configWith([{ name: 'builder', writes: ['*'] }])

    // when
    const protectedPath = permitted(
      '.pi-crust/modules/use-cases/run-checks.ts',
      agentNamed(cfg, 'builder'),
      cfg,
    )
    const ordinaryPath = permitted(
      'src/server.ts',
      agentNamed(cfg, 'builder'),
      cfg,
    )

    // then
    expect(protectedPath).toEqual(false)
    expect(ordinaryPath).toEqual(true)
  },
)

test(
  [
    'given use-cases/enforce-permissions::permitted',
    'when an agent names a protected path in its own writes',
    'it should be unlocked for that agent only',
  ].join(', '),
  () => {
    // given
    const cfg = configWith([
      { name: 'maintainer', writes: ['.pi-crust/modules/'] },
      { name: 'builder', writes: ['*'] },
    ])

    // when
    const unlocked = permitted(
      '.pi-crust/modules/data/git.ts',
      agentNamed(cfg, 'maintainer'),
      cfg,
    )
    const stillBarred = permitted(
      '.pi-crust/modules/data/git.ts',
      agentNamed(cfg, 'builder'),
      cfg,
    )

    // then
    expect(unlocked).toEqual(true)
    expect(stillBarred).toEqual(false)
  },
)

test(
  [
    'given use-cases/enforce-permissions::changedPaths',
    'when a path was dirty before and is clean after',
    'it should report the reversion as a change',
  ].join(', '),
  () => {
    // given
    const before = { 'src/a.ts': '3,1', 'src/b.ts': '1,0' }
    const after = { 'src/b.ts': '1,0', 'src/c.ts': 'untracked' }

    // when
    const actual = changedPaths(before, after)

    // then
    expect(actual).toEqual(['src/a.ts', 'src/c.ts'])
  },
)

test(
  [
    'given use-cases/enforce-permissions::permitted',
    'when an agent declares an empty writes list',
    'it should be refused everywhere, because nothing grants it anything',
  ].join(', '),
  () => {
    // given
    const cfg = configWith([{ name: 'scout', writes: [] }])

    // when
    const actual = permitted('src/server.ts', agentNamed(cfg, 'scout'), cfg)

    // then
    expect(actual).toEqual(false)
  },
)

test(
  [
    'given use-cases/enforce-permissions::resolveWrites',
    'when a pattern names the handoff directory by token',
    'it should become a path relative to the repository root',
  ].join(', '),
  () => {
    // given
    const given = ['{handoff}/review.md', 'specs/']

    // when
    const actual = resolveWrites(
      given,
      '/repo',
      '/repo/.pi-crust/data/sessions/abc/context_handoff',
    )

    // then
    expect(actual).toEqual([
      '.pi-crust/data/sessions/abc/context_handoff/review.md',
      'specs/',
    ])
  },
)

test(
  [
    'given use-cases/enforce-permissions::resolveWrites',
    'when the handoff directory sits outside the repository',
    'it should stay absolute, so no snapshot path can ever match it',
  ].join(', '),
  () => {
    // given
    const given = ['{handoff}/review.md']

    // when
    const actual = resolveWrites(given, '/repo', '/elsewhere/handoff')

    // then
    expect(actual).toEqual(['/elsewhere/handoff/review.md'])
  },
)

test(
  [
    'given use-cases/enforce-permissions::handoffDocument',
    'when an agent declares a handoff document among other paths',
    'it should name that document, so the prompt and the permission agree',
  ].join(', '),
  () => {
    // given
    const given = ['{handoff}/plan.md', 'specs/']

    // when
    const actual = handoffDocument(given, '/repo', '/repo/handoff')

    // then
    expect(actual).toEqual('handoff/plan.md')
  },
)

test(
  [
    'given use-cases/enforce-permissions::handoffDocument',
    'when an agent writes only repository paths',
    'it should name nothing rather than mistake a glob for its document',
  ].join(', '),
  () => {
    // given
    const given = ['**/*.test.ts', '**/tests/']

    // when
    const actual = handoffDocument(given, '/repo', '/repo/handoff')

    // then
    expect(actual).toBeUndefined()
  },
)
