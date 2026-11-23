import { expect, test } from 'bun:test'
import { aLayer } from './config-layer-fixture.test'
import { layerFaults } from './layer-faults'

for (const key of ['defaults', 'tasks', 'typo', 'routing', 'override']) {
  test(
    [
      `given ${key} in an activities file`,
      'when checking file keys',
      'it should name the file and destination unless removed-setting validation owns it',
    ].join(', '),
    () => {
      // given
      const layer = aLayer('machine', { [key]: {} })
      const layers = [
        {
          ...layer,
          files: layer.files.map((file) => ({
            ...file,
            allowedKeys: ['activities'],
          })),
        },
      ]
      // when
      const actual = layerFaults(layers)
      // then
      if (['routing', 'override'].includes(key)) expect(actual).toEqual([])
      else {
        expect(actual[0]).toContain('/machine/pi-crust.toml')
        expect(actual[0]).toContain(
          key === 'defaults' ? 'crust.config.toml' : 'pi-crust.toml',
        )
      }
    },
  )
}

test(
  [
    'given allowed file keys',
    'when checked',
    'it should report no faults',
  ].join(', '),
  () => {
    // given
    // when
    const actual = layerFaults([
      aLayer('repository', { activities: {}, tasks: {} }),
    ])
    // then
    expect(actual).toEqual([])
  },
)
