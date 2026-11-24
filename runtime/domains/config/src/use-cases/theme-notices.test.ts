import { expect, test } from 'bun:test'
import { aLayer } from './config-layer-fixture.test'
import { themeNotices } from './theme-notices'

test(
  [
    'given theme tables in every layer',
    'when notices are built',
    'it should warn in layer and file order except for machine files',
  ].join(', '),
  () => {
    // given
    const layers = [
      aLayer('package', { themes: {} }),
      aLayer('machine', { themes: {} }),
      aLayer('repository', { themes: {} }),
    ]
    // when
    const actual = themeNotices(layers, '/machine')
    // then
    expect(actual.length).toBe(2)
    expect(
      actual.every((notice) =>
        notice.endsWith(
          'themes are read only from /machine/crust.config.toml; this table is ignored.',
        ),
      ),
    ).toBe(true)
    expect(themeNotices([aLayer('package', {})], '/machine')).toEqual([])
  },
)
