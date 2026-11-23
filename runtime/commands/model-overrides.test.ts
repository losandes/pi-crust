import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { EXIT } from '../lib/contracts'
import { SKIP_INTEGRATION } from '../testing/integration'

for (const recipe of ['operator', 'triage']) {
  for (const flags of [
    ['--model', 'build=openai/gpt-5@high'],
    ['--model=build=openai/gpt-5@high'],
    ['-m', 'build=@high'],
    ['-m=build=@high'],
    ['--model='],
  ]) {
    test.skipIf(SKIP_INTEGRATION)(
      [
        `given stages/${recipe}'s CLI`,
        `when ${flags.join(' ')} is defined`,
        'it should refuse with usage status before loading a config or starting a run',
      ].join(', '),
      () => {
        // given
        const argv = [
          'bun',
          join(import.meta.dir, `${recipe}.ts`),
          'do the work',
          '--config',
          '/nonexistent/crust-model-overrides.toml',
          ...flags,
        ]

        // when
        const actual = Bun.spawnSync(argv, { stdout: 'pipe', stderr: 'pipe' })

        // then
        expect(actual.exitCode).toBe(EXIT.USAGE)
        expect(actual.stdout.toString()).toBe('')
        expect(actual.stderr.toString()).toBe(
          `--model applies to \`just crust run\` only — the ${recipe} chooses its activities as it goes, so which ones an override reaches cannot be known when the run starts\n`,
        )
      },
    )
  }
}
