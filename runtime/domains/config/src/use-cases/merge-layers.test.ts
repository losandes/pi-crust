import { expect, test } from 'bun:test'
import { isTable, mergeLayers, tableOf } from './merge-layers'

for (const section of ['activities', 'lifecycles', 'tasks', 'terminal']) {
  test(
    [
      `given ${section} tables in two layers`,
      'when merged',
      'it should recursively merge tables and replace arrays and scalars',
    ].join(', '),
    () => {
      // given
      const earlier = {
        [section]: {
          one: {
            model: 'old',
            purpose: 'keep',
            tools: ['read', 'write'],
            stages: [{ name: 'old' }],
            delivery: { remote: 'upstream', draft: false },
          },
        },
      }
      const later = {
        [section]: {
          one: {
            model: 'new',
            tools: [],
            stages: [{ name: 'new' }],
            delivery: { draft: true },
          },
          two: { purpose: 'new entry' },
        },
      }
      // when
      const actual = mergeLayers(earlier, later)
      // then
      expect(actual).toEqual({
        [section]: {
          one: {
            model: 'new',
            purpose: 'keep',
            tools: [],
            stages: [{ name: 'new' }],
            delivery: { remote: 'upstream', draft: true },
          },
          two: { purpose: 'new entry' },
        },
      })
      expect(earlier[section]?.one.model).toBe('old')
    },
  )
}

for (const value of [undefined, 0, 'text', [], { nested: true }]) {
  test(
    [
      `given a value ${JSON.stringify(value)}`,
      'when interpreted as a table',
      'it should accept only plain objects',
    ].join(', '),
    () => {
      // given
      // when
      const actual = tableOf(value)
      // then
      expect(actual).toEqual(isTable(value) ? value : {})
    },
  )
}
