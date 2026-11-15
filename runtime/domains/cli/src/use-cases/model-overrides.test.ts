import { expect, test } from 'bun:test'
import { parseModelOverrides } from './model-overrides'

const cases = [
  {
    entry: 'build=openai/gpt-5@high',
    overrides: [{ name: 'build', model: 'openai/gpt-5', thinking: 'high' }],
    warnings: [],
  },
  {
    entry: 'build=openai/gpt-5',
    overrides: [{ name: 'build', model: 'openai/gpt-5', thinking: undefined }],
    warnings: [],
  },
  {
    entry: 'build=@high',
    overrides: [{ name: 'build', model: undefined, thinking: 'high' }],
    warnings: [],
  },
  {
    entry: 'openai/gpt-5',
    overrides: [],
    warnings: [
      "--model: ignored 'openai/gpt-5' — name the activity it applies to, as <activity>=<provider/model>@<thinking>",
    ],
  },
  {
    entry: 'build=',
    overrides: [],
    warnings: [
      "--model: ignored 'build=' — it sets neither a model nor a thinking level",
    ],
  },
  {
    entry: 'build=@',
    overrides: [],
    warnings: [
      "--model: ignored 'build=@' — it sets neither a model nor a thinking level",
    ],
  },
  {
    entry: '=openai/gpt-5@high',
    overrides: [],
    warnings: [
      "--model: ignored '=openai/gpt-5@high' — it sets neither a model nor a thinking level",
    ],
  },
  {
    entry: 'build=openai/gpt-5@extreme',
    overrides: [{ name: 'build', model: 'openai/gpt-5', thinking: undefined }],
    warnings: [
      "--model: ignored thinking level 'extreme' for 'build' — use one of off, minimal, low, medium, high, xhigh, max",
    ],
  },
  {
    entry: 'build=@extreme',
    overrides: [{ name: 'build', model: undefined, thinking: undefined }],
    warnings: [
      "--model: ignored thinking level 'extreme' for 'build' — use one of off, minimal, low, medium, high, xhigh, max",
    ],
  },
  {
    entry: 'biuld=openai/gpt-5',
    overrides: [{ name: 'biuld', model: 'openai/gpt-5', thinking: undefined }],
    warnings: [],
  },
  {
    entry: 'ux-design=@high',
    overrides: [{ name: 'ux-design', model: undefined, thinking: 'high' }],
    warnings: [],
  },
  {
    entry: 'build=provider/model=variant@high',
    overrides: [
      { name: 'build', model: 'provider/model=variant', thinking: 'high' },
    ],
    warnings: [],
  },
  {
    entry: 'build=provider/model@revision@high',
    overrides: [
      { name: 'build', model: 'provider/model@revision', thinking: 'high' },
    ],
    warnings: [],
  },
  {
    entry: 'build=openai/gpt-5@',
    overrides: [{ name: 'build', model: 'openai/gpt-5', thinking: undefined }],
    warnings: [],
  },
  {
    entry: 'build=not-a-known-model',
    overrides: [
      { name: 'build', model: 'not-a-known-model', thinking: undefined },
    ],
    warnings: [],
  },
] as const

for (const { entry, overrides, warnings } of cases) {
  test(
    [
      'given use-cases/model-overrides::parseModelOverrides',
      `when the entry is ${entry}`,
      'it should return its applicable fields and actionable warnings without throwing',
    ].join(', '),
    () => {
      // given
      const value = entry

      // when
      const actual = parseModelOverrides(value)

      // then
      expect(actual).toEqual({ overrides, warnings })
    },
  )
}

for (const thinking of [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]) {
  test(
    [
      'given use-cases/model-overrides::parseModelOverrides',
      `when the thinking level is ${thinking}`,
      'it should accept it without checking a model catalogue',
    ].join(', '),
    () => {
      // given
      const value = `build=@${thinking}`

      // when
      const actual = parseModelOverrides(value)

      // then
      expect(actual).toEqual({
        overrides: [{ name: 'build', model: undefined, thinking }],
        warnings: [],
      })
    },
  )
}

test(
  [
    'given use-cases/model-overrides::parseModelOverrides',
    'when whitespace and empty comma entries surround several overrides',
    'it should trim entries and drop empty entries silently',
  ].join(', '),
  () => {
    // given
    const value = ' , build=openai/gpt-5@high, , code-review=@xhigh, '

    // when
    const actual = parseModelOverrides(value)

    // then
    expect(actual).toEqual({
      overrides: [
        { name: 'build', model: 'openai/gpt-5', thinking: 'high' },
        { name: 'code-review', model: undefined, thinking: 'xhigh' },
      ],
      warnings: [],
    })
    expect(parseModelOverrides(' , , ')).toEqual({
      overrides: [],
      warnings: [],
    })
    expect(parseModelOverrides('')).toEqual({ overrides: [], warnings: [] })
  },
)

test(
  [
    'given use-cases/model-overrides::parseModelOverrides',
    'when the same activity is named twice',
    'it should replace the entire earlier override and name the later entry in a warning',
  ].join(', '),
  () => {
    // given
    const value = 'build=openai/gpt-5,test=@low, build=@high '

    // when
    const actual = parseModelOverrides(value)

    // then
    expect(actual).toEqual({
      overrides: [
        { name: 'test', model: undefined, thinking: 'low' },
        { name: 'build', model: undefined, thinking: 'high' },
      ],
      warnings: [
        "--model: 'build' is named more than once — using 'build=@high'",
      ],
    })
  },
)

test(
  [
    'given use-cases/model-overrides::parseModelOverrides',
    'when an ignored entry follows a valid override for the same name',
    'it should keep the valid override and report the ignored entry',
  ].join(', '),
  () => {
    // given
    const value = 'build=openai/gpt-5,build='

    // when
    const actual = parseModelOverrides(value)

    // then
    expect(actual).toEqual({
      overrides: [
        { name: 'build', model: 'openai/gpt-5', thinking: undefined },
      ],
      warnings: [
        "--model: ignored 'build=' — it sets neither a model nor a thinking level",
      ],
    })
  },
)
