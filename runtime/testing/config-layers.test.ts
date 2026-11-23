import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { layersFixture } from './config-layers'

for (const extra of [false, true]) {
  test(
    [
      `given a configuration-layer fixture with extra files ${extra}`,
      'when created and disposed',
      'it should isolate package, machine and repository inputs and remove the scratch directory',
    ].join(', '),
    () => {
      // given
      const fixture = extra
        ? layersFixture({ 'machine/crust.config.toml': 'poll_ms = 250\n' })
        : layersFixture()
      try {
        // when
        const written = fixture.write('repository/extra.toml', '# extra\n')
        // then
        expect(readFileSync(fixture.repositoryPath, 'utf8')).toBe('# empty\n')
        expect(readFileSync(written, 'utf8')).toBe('# extra\n')
        expect(fixture.env.CRUST_PACKAGE_CONFIG).not.toBe(
          fixture.env.CRUST_MACHINE_CONFIG,
        )
        expect(existsSync(fixture.env.HOME)).toBe(false)
      } finally {
        fixture[Symbol.dispose]()
      }
      expect(existsSync(fixture.root)).toBe(false)
    },
  )
}
