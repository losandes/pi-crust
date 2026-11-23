import { expect, test } from 'bun:test'
import { configText, repositoryDocument, tomlText } from './config-document'

test(
  [
    'given a document already in the written TOML shape',
    'when serialized without repository fixture normalization',
    'it should return text preserving exactly the declared tables',
  ].join(', '),
  () => {
    // given
    const document = { defaults: { model: 'fixture/model' } }
    // when
    const actual = tomlText(document)
    // then
    expect(Bun.TOML.parse(actual)).toEqual(document)
  },
)

for (const keyed of [false, true]) {
  test(
    [
      `given ${keyed ? 'keyed' : 'loaded'} test configuration`,
      'when encoded as repository TOML',
      'it should name entries by key and translate loaded observability and stage shapes',
    ].join(', '),
    () => {
      // given
      const entries = [
        { name: 'build', prompts: '/prompts/build', writes: ['src/'] },
      ]
      const document = {
        agents: [
          ...entries,
          { name: 'operator', prompts: '/operator' },
          { name: 'gh-pull-request', prompts: '/terminal' },
        ],
        ...(keyed
          ? {
              activities: { build: entries[0] },
              planners: { operator: { prompts: '/operator' } },
              terminal: { 'gh-pull-request': { prompts: '/terminal' } },
            }
          : {}),
        observability: { poll_ms: 250 },
        lifecycles: [
          {
            name: 'quick',
            stages: [
              { name: 'work', strategy: 'serial', activities: ['build'] },
            ],
          },
        ],
      }
      // when
      const actual = Bun.TOML.parse(configText(document))
      // then
      expect(actual).toMatchObject({
        poll_ms: 250,
        activities: { build: { prompts: '/prompts/build', writes: ['src/'] } },
        planners: { operator: { prompts: '/operator' } },
        terminal: { 'gh-pull-request': { prompts: '/terminal' } },
        lifecycles: {
          quick: { stages: [{ name: 'work', serial: ['build'] }] },
        },
      })
      expect(actual).not.toHaveProperty('agents')
      expect(actual).not.toHaveProperty('observability')
    },
  )
}

test(
  [
    'given minimal and already-written fixture declarations',
    'when normalized',
    'it should fill required engine fixture entries and retain written stages and invalid stage data for validation',
  ].join(', '),
  () => {
    // given
    // when
    const minimal = repositoryDocument({})
    const written = repositoryDocument({
      activities: {},
      lifecycles: {
        quick: { stages: [{ name: 'work', concurrent: ['build'] }] },
        invalid: { stages: 'not-an-array' },
      },
    })
    // then
    expect(minimal).toMatchObject({
      activities: {},
      planners: { operator: { writes: [] }, triage: { writes: [] } },
      terminal: { 'gh-pull-request': { writes: [] } },
    })
    expect(written.lifecycles).toEqual({
      quick: { stages: [{ name: 'work', concurrent: ['build'] }] },
      invalid: { stages: 'not-an-array' },
    })
  },
)
