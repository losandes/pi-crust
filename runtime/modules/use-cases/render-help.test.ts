import { expect, test } from 'bun:test'
import type { TCatalogue } from '../../catalogue'
import { renderCatalogue } from '../../catalogue'
import { recipeDoc } from './recipe-docs'
import { renderHelp } from './render-help'

const FABRICATED_CATALOGUE: TCatalogue = {
  lifecycles: [{ name: 'sdlc', detail: 'the whole lifecycle' }],
  planners: [{ name: 'operator', detail: 'chooses the chain and runs it' }],
  activities: [{ name: 'build', detail: 'write the code' }],
  terminal: [{ name: 'gh-pull-request', detail: 'open the PR' }],
}

test(
  [
    'given render-help::renderHelp',
    'when a catalogue is present and no topic is named',
    "it should contain renderCatalogue's own output verbatim",
  ].join(', '),
  () => {
    // given
    const view = {
      catalogue: FABRICATED_CATALOGUE,
      catalogueNote: undefined,
      topic: undefined,
    }

    // when
    const actual = renderHelp(view)

    // then
    expect(actual).toContain(renderCatalogue(FABRICATED_CATALOGUE))
  },
)

test(
  [
    'given render-help::renderHelp',
    'when no topic is named',
    'it should mention every documented recipe and close with the narrowing hint',
  ].join(', '),
  () => {
    // given
    const view = {
      catalogue: FABRICATED_CATALOGUE,
      catalogueNote: undefined,
      topic: undefined,
    }

    // when
    const actual = renderHelp(view)

    // then
    expect(actual).toContain('run')
    expect(actual).toContain('observe')
    expect(actual).toContain(
      'just crust help <recipe> narrows this to one recipe.',
    )
  },
)

test(
  [
    'given render-help::renderHelp',
    'when a topic is named',
    "it should print only that recipe's entry",
  ].join(', '),
  () => {
    // given
    const run = recipeDoc('run')
    const view = { catalogue: undefined, catalogueNote: undefined, topic: run }

    // when
    const actual = renderHelp(view)

    // then
    expect(actual).toContain('--lifecycle')
    expect(actual).not.toContain('--overwrite')
    expect(actual).not.toContain(
      'just crust help <recipe> narrows this to one recipe.',
    )
  },
)

test(
  [
    'given render-help::renderHelp',
    'when the catalogue could not be read',
    'it should still render the recipe reference, with the note in place of the catalogue',
  ].join(', '),
  () => {
    // given
    const view = {
      catalogue: undefined,
      catalogueNote: 'ENOENT: no such file or directory',
      topic: undefined,
    }

    // when
    const actual = renderHelp(view)

    // then
    expect(actual).toContain('ENOENT: no such file or directory')
    expect(actual).toContain('run')
  },
)
