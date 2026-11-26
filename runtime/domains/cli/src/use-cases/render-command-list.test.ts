import { expect, test } from 'bun:test'
import { RECIPE_DOCS, recipeDoc, type TRecipeDoc } from './recipe-docs'
import { renderCommandList } from './render-command-list'

for (const name of ['gh-issue', 'ship', 'ship-plan', 'ship-outcome']) {
  test(
    [
      `given the ${name} command`,
      'when the command table is listed',
      'it should appear once with its summary',
    ].join(', '),
    () => {
      // given
      // when
      const lines = renderCommandList(RECIPE_DOCS)
        .split('\n')
        .filter((line) => line.startsWith(`${name} `))
      // then
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain(
        recipeDoc(name)?.summary ?? 'missing definition',
      )
    },
  )
}

test(
  [
    'given an injected probe',
    'when listed',
    'it should carry its summary in table order',
  ].join(', '),
  () => {
    // given
    const base = RECIPE_DOCS.find((doc) => doc.name === 'run') as TRecipeDoc
    const docs = [
      { ...base, name: 'probe', summary: 'probe summary' },
      { ...base, name: 'x', summary: 'short' },
    ]
    // when
    const result = renderCommandList(docs)
    // then
    expect(result).toBe('probe  probe summary\nx      short')
    expect(renderCommandList([])).toBe('')
  },
)
