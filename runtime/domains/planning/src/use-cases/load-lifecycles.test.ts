import { expect, test } from 'bun:test'
import { activityOrder, crustConfigSchema } from '../../../../lib/contracts'
import { loadLifecycles } from './load-lifecycles'

for (const strategy of ['serial', 'concurrent'] as const) {
  test(
    [
      `given a loaded ${strategy} lifecycle`,
      'when normalized',
      'it should preserve Stage order and canonicalize Activity aliases',
    ].join(', '),
    () => {
      // given
      const cfg = crustConfigSchema.parse({
        activities: [
          { name: 'plan', prompts: '.', writes: ['plan/'], aliases: ['p'] },
          { name: 'build', prompts: '.', writes: ['build/'] },
        ],
        lifecycles: [
          {
            name: 'ship',
            stages: [{ name: 'work', strategy, activities: ['p', 'build'] }],
          },
        ],
      })
      // when
      const actual = loadLifecycles(cfg)
      // then
      expect(actual[0]?.stages[0]?.strategy).toBe(strategy)
      expect(
        activityOrder(actual[0] ?? { name: '', description: '', stages: [] }),
      ).toEqual(['plan', 'build'])
    },
  )
}

for (const scenario of [
  'duplicate-stage',
  'mixed-judge-writer',
  'overlapping-writes',
]) {
  test(
    [
      `given ${scenario} in a loaded lifecycle`,
      'when validated',
      'it should refuse before a run starts',
    ].join(', '),
    () => {
      // given
      const cfg = crustConfigSchema.parse({
        activities: [
          {
            name: 'one',
            prompts: '.',
            output:
              scenario === 'mixed-judge-writer' ? 'reviewOutput' : 'planOutput',
            writes: ['one/'],
          },
          {
            name: 'two',
            prompts: '.',
            output: 'planOutput',
            writes: scenario === 'overlapping-writes' ? ['one/'] : ['two/'],
          },
        ],
        lifecycles: [
          {
            name: 'broken',
            stages:
              scenario === 'duplicate-stage'
                ? [
                    { name: 'same', activities: ['one'] },
                    { name: 'same', activities: ['two'] },
                  ]
                : [
                    {
                      name: 'work',
                      strategy: 'concurrent',
                      activities: ['one', 'two'],
                    },
                  ],
          },
        ],
      })
      // when
      const actual = () => loadLifecycles(cfg)
      // then
      expect(actual).toThrow('lifecycle configuration cannot run:')
      expect(actual).toThrow(
        scenario === 'duplicate-stage'
          ? 'two stages'
          : scenario === 'mixed-judge-writer'
            ? 'one judges'
            : 'both may write',
      )
    },
  )
}

test(
  [
    'given no loaded lifecycles',
    'when queried',
    'it should return an empty list',
  ].join(', '),
  () => {
    // given
    const cfg = crustConfigSchema.parse({})
    // when
    const actual = loadLifecycles(cfg)
    // then
    expect(actual).toEqual([])
  },
)
