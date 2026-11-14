import { expect, test } from 'bun:test'
import { cx } from '..'

const cases = [
  { name: 'no parts', parts: [], expected: '' },
  { name: 'a single class', parts: ['flex'], expected: 'flex' },
  {
    name: 'several classes',
    parts: ['flex', 'items-center', 'gap-2'],
    expected: 'flex items-center gap-2',
  },
  {
    name: 'conditional and absent parts',
    parts: [false, 'flex', undefined, 'gap-2', false],
    expected: 'flex gap-2',
  },
  { name: 'empty strings', parts: ['', 'flex', ''], expected: 'flex' },
  {
    name: 'only omitted parts',
    parts: [false, undefined, ''],
    expected: '',
  },
  {
    name: 'repeated classes',
    parts: ['flex', 'flex'],
    expected: 'flex flex',
  },
  {
    name: 'whitespace inside a part',
    parts: [' flex ', 'gap-2'],
    expected: ' flex  gap-2',
  },
] as const

for (const { name, parts, expected } of cases) {
  test(
    [
      `given ${name}`,
      'when cx joins the parts',
      'it should preserve the applicable classes in order',
    ].join(', '),
    () => {
      // given — the readonly parts and expected result in this case

      // when
      const actual = cx(...parts)

      // then
      expect(actual).toBe(expected)
    },
  )
}
