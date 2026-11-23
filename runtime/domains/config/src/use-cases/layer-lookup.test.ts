import { expect, test } from 'bun:test'
import { aLayer } from './config-layer-fixture.test'
import { firstDeclaringLayer, lastStatingFile, valueAt } from './layer-lookup'

for (const name of ['build', 'machine-only', 'missing']) {
  test(
    [
      `given declarations and patches for ${name}`,
      'when looking up first declaration and last field',
      'it should distinguish ownership from provenance',
    ].join(', '),
    () => {
      // given
      const layers = [
        aLayer('package', { activities: { build: { model: 'package' } } }),
        aLayer('machine', {
          activities: { build: { model: 'machine' }, 'machine-only': {} },
        }),
      ]
      // when
      const first = firstDeclaringLayer(layers, 'activities', name)
      const last = lastStatingFile(layers, ['activities', name, 'model'])
      // then
      expect(first?.name).toBe(
        name === 'build'
          ? 'package'
          : name === 'machine-only'
            ? 'machine'
            : undefined,
      )
      expect(last?.layer).toBe(name === 'build' ? 'machine' : undefined)
      expect(valueAt({ one: { two: 2 } }, ['one', 'two'])).toBe(2)
      expect(valueAt({}, ['absent', 'nested'])).toBeUndefined()
    },
  )
}
