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
 * runs reports is the one it was written to report. File validation uses a
 * fixture model resolver: the live `pi --list-models` process adds host
 * dependencies and startup time to tests that do not exercise model discovery.
 */
const configWith = (
  agents: readonly Readonly<Record<string, unknown>>[],
): TPiCrustConfig =>
  crustConfigSchema.parse({
    activities: agents.map((agent) => ({
      prompts: {
        system: 'prompts/plan/system.md',
        user: 'prompts/plan/user.md',
      },
      writes: [],
      ...agent,
    })),
    agents: agents.map((agent) => ({
      prompts: {
        system: 'prompts/plan/system.md',
        user: 'prompts/plan/user.md',
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
            prompts: {
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
    validateAgents(cfg, names, () => ({ provider: 'test', modelId: 'test' }))

    return ''
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
}

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
        prompts: {
          system: 'prompts/nope/system.md',
          user: 'prompts/plan/user.md',
        },
      },
    ])

    // when
    const actual = problemsFrom(cfg, ['plan'])

    // then
    expect(actual).toContain('system prompt not found')
  },
)
