import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TPiCrustConfig } from '../../../../lib/contracts'
import { crustConfigSchema } from '../../../../lib/contracts'
import { validateAgents } from './validate-agents'

/**
 * A roster that is valid apart from whatever the test is about.
 *
 * The prompts name files the package ships, so the only problem any of these
 * runs reports is the one it was written to report. The model is left off:
 * `resolveModel` shells out to `pi --list-models`, which is an environment
 * these tests do not have and do not need — every assertion here is about a
 * path on disk.
 */
const configWith = (
  agents: readonly Readonly<Record<string, unknown>>[],
): TPiCrustConfig =>
  crustConfigSchema.parse({
    activities: agents.map((agent) => ({
      prompt_engineering: {
        system: 'prompt-engineering/plan/system.md',
        user: 'prompt-engineering/plan/user.md',
      },
      writes: [],
      ...agent,
    })),
    agents: agents.map((agent) => ({
      prompt_engineering: {
        system: 'prompt-engineering/plan/system.md',
        user: 'prompt-engineering/plan/user.md',
      },
      writes: [],
      ...agent,
    })),
  })

for (const revise of ['missing', 'directory', 'present', 'absent'] as const) {
  test(
    [
      `given an agent with a ${revise} revise prompt`,
      'when validating its prompt references',
      'it should require only an explicitly configured revise file',
    ].join(', '),
    () => {
      // given
      const root = mkdtempSync(join(tmpdir(), 'crust-validate-revise-'))
      try {
        const user = join(root, 'user.md')
        const reference =
          revise === 'directory' ? root : join(root, 'revise.md')
        writeFileSync(user, 'user', { flag: 'wx' })
        if (revise === 'present')
          writeFileSync(reference, 'revise', { flag: 'wx' })
        const cfg = configWith([
          {
            name: 'build',
            prompt_engineering: {
              system: user,
              user,
              ...(revise === 'absent' ? {} : { revise: reference }),
            },
          },
        ])
        const validate = () =>
          validateAgents(cfg, ['build'], () => ({
            provider: 'test',
            modelId: 'test',
          }))

        // when, then
        if (revise === 'missing' || revise === 'directory') {
          expect(validate).toThrow(
            `agent 'build': revise prompt not found: ${reference} (looked in ${reference})`,
          )
        } else {
          expect(validate).not.toThrow()
        }
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
}

const problemsFrom = (
  cfg: TPiCrustConfig,
  names: readonly string[],
): string => {
  try {
    validateAgents(cfg, names)

    return ''
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
}

test(
  [
    'given use-cases/validate-agents::validateAgents',
    'when an agent names a harness extension nothing can open',
    'it should refuse before the run, naming the reference and where it looked',
  ].join(', '),
  () => {
    // given — pi exits 1 on a missing extension AFTER the session is minted
    // and the spend has started, several paid Activity Runs into a chain
    const cfg = configWith([
      { name: 'plan', harness_engineering: ['harness-engineering/nope.ts'] },
    ])

    // when
    const actual = problemsFrom(cfg, ['plan'])

    // then — both the reference and the resolved path, because reporting one
    // of them sends a developer looking in the wrong place
    expect(actual).toContain('harness extension not found')
    expect(actual).toContain('harness-engineering/nope.ts')
    expect(actual).toContain('looked in')
  },
)

test(
  [
    'given use-cases/validate-agents::validateAgents',
    'when the extension is one the package ships',
    'it should raise nothing about it, because a reference resolves there too',
  ].join(', '),
  () => {
    // given — nothing is stamped any more, so a reference resolved against
    // the repository alone finds nothing and the run dies mid-chain
    const cfg = configWith([
      {
        name: 'plan',
        harness_engineering: ['harness-engineering/subagents.ts'],
      },
    ])

    // when
    const actual = problemsFrom(cfg, ['plan'])

    // then
    expect(actual).not.toContain('harness extension')
  },
)

test(
  [
    'given use-cases/validate-agents::validateAgents',
    'when a prompt cannot be found',
    'it should still report that, which is the check this one was modelled on',
  ].join(', '),
  () => {
    // given
    const cfg = configWith([
      {
        name: 'plan',
        prompt_engineering: {
          system: 'prompt-engineering/nope/system.md',
          user: 'prompt-engineering/plan/user.md',
        },
      },
    ])

    // when
    const actual = problemsFrom(cfg, ['plan'])

    // then
    expect(actual).toContain('system prompt not found')
  },
)
