import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TCliArgs, TWorkflowArgs } from '../domains/cli'
import { configText } from '../testing/config-document'
import { restoreTerminal, silenceTerminal } from '../testing/terminal-capture'
import { main } from './run'

const args = (over: Partial<TWorkflowArgs>): TWorkflowArgs => ({
  prompt: 'x',
  config: 'pi-crust.toml',
  runId: undefined,
  base: undefined,
  resume: false,
  activities: undefined,
  lifecycle: undefined,
  models: undefined,
  approveAfter: undefined,
  commit: undefined,
  stream: false,
  trustLevel: undefined,
  handoff: undefined,
  name: undefined,
  ...over,
})

test(
  [
    'given commands/run::main',
    'when the named lifecycle is not one the repository offers',
    'it should report the error and exit 2 without starting a run',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const configPath = join(
        mkdtempSync(join(tmpdir(), 'crust-compose-main-')),
        'pi-crust.toml',
      )
      writeFileSync(
        configPath,
        configText({
          activities: [
            {
              name: 'identify',
              purpose: 'Do the identify work and report it',
              prompts: '.',
            },
          ],
        }),
      )
      const original = process.stderr.write.bind(process.stderr)
      let printed = ''
      // biome-ignore lint/plugin/no-object-mutation: swapping Node's own stderr.write for the capture, restored below
      process.stderr.write = ((chunk: string) => {
        printed += chunk
        return true
      }) as typeof process.stderr.write

      // when
      const actual = main(
        args({ config: configPath, lifecycle: 'does-not-exist' }),
      )

      // then
      return actual.then((code) => {
        // biome-ignore lint/plugin/no-object-mutation: restoring Node's own stderr.write after the capture
        process.stderr.write = original
        expect(code).toEqual(2)
        expect(printed).toContain('unknown lifecycle')
      })
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given commands/run::runFromCli',
    'when the parsed args name an unknown lifecycle',
    "it should resolve the prompt and delegate to main, which reports main's own error",
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const configPath = join(
        mkdtempSync(join(tmpdir(), 'crust-compose-run-from-cli-')),
        'pi-crust.toml',
      )
      writeFileSync(
        configPath,
        configText({
          activities: [
            {
              name: 'identify',
              purpose: 'Do the identify work and report it',
              prompts: '.',
            },
          ],
        }),
      )
      const original = process.stderr.write.bind(process.stderr)
      let printed = ''
      // biome-ignore lint/plugin/no-object-mutation: swapping Node's own stderr.write for the capture, restored below
      process.stderr.write = ((chunk: string) => {
        printed += chunk
        return true
      }) as typeof process.stderr.write
      const cliArgs = args({
        config: configPath,
        lifecycle: 'does-not-exist',
      }) as TCliArgs

      // when
      const actual = main(cliArgs)

      // then
      return actual.then((code) => {
        // biome-ignore lint/plugin/no-object-mutation: restoring Node's own stderr.write after the capture
        process.stderr.write = original
        expect(code).toEqual(2)
        expect(printed).toContain('unknown lifecycle')
      })
    } finally {
      restoreTerminal()
    }
  },
)
