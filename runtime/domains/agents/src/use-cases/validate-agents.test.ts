import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crustConfigSchema } from '../../../../lib/contracts'
import { validateAgents } from './validate-agents'

for (const missing of ['system', 'user', 'neither'] as const) {
  test(
    [
      `given @SC14 an agent missing ${missing} required prompt files`,
      'when validated for a run',
      'it should report the Activity, filename and directory while treating revise.md as optional',
    ].join(', '),
    () => {
      // given
      const root = mkdtempSync(join(tmpdir(), 'crust-validate-'))
      try {
        if (missing !== 'system')
          writeFileSync(join(root, 'system.md'), 'system')
        if (missing !== 'user') writeFileSync(join(root, 'user.md'), 'user')
        const cfg = crustConfigSchema.parse({
          agents: [{ name: 'build', prompts: root, writes: [] }],
        })
        // when
        const actual = () =>
          validateAgents(cfg, ['build'], () => ({
            provider: 'test',
            modelId: 'test',
          }))
        // then
        if (missing === 'neither') expect(actual).not.toThrow()
        else
          expect(actual).toThrow(
            `agent 'build': ${missing}.md not found in ${root}`,
          )
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
}

for (const mode of ['unknown', 'model', 'host'] as const) {
  test(
    [
      `given an agent with an invalid ${mode}`,
      'when validated',
      'it should aggregate the failure before execution',
    ].join(', '),
    () => {
      // given
      const cfg = crustConfigSchema.parse({
        agents: [
          {
            name: 'build',
            prompts: '/absent',
            writes: [],
            coding_agent: mode === 'host' ? 'claude_code' : 'pi',
          },
        ],
      })
      // when
      const actual = () =>
        validateAgents(cfg, [mode === 'unknown' ? 'missing' : 'build'], () => {
          if (mode === 'model') throw new Error('model unavailable')
          return { provider: 'test', modelId: 'test' }
        })
      // then
      expect(actual).toThrow(
        mode === 'unknown'
          ? 'not defined in the config'
          : mode === 'model'
            ? 'model unavailable'
            : 'not implemented in v1',
      )
    },
  )
}
