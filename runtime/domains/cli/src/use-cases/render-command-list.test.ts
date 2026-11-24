import { expect, test } from 'bun:test'
import { RECIPE_DOCS, type TRecipeDoc } from './recipe-docs'
import { renderCommandList } from './render-command-list'

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
