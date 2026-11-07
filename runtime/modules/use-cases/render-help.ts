/**
 * Renders `just crust help`'s output: pure, no IO, no process.
 *
 * The catalogue half is `renderCatalogue(catalogue)` verbatim, so `help` is a
 * strict superset of `list` rather than a second implementation of it.
 */

import type { TCatalogue } from '../../catalogue'
import { renderCatalogue } from '../../catalogue'
import { paint } from '../data/terminal'
import {
  GLOBAL_ENV,
  GLOBAL_FLAGS,
  GROUPS,
  RECIPE_DOCS,
  type TDocLine,
  type TRecipeDoc,
} from './recipe-docs'

export type THelpView = Readonly<{
  /** undefined when the configuration could not be read */
  catalogue: TCatalogue | undefined
  /** why the catalogue is missing, already worded for a reader */
  catalogueNote: string | undefined
  /** one recipe, or undefined for everything */
  topic: TRecipeDoc | undefined
}>

const renderLines = (lines: readonly TDocLine[]): readonly string[] => {
  const width = Math.max(...lines.map((line) => line.name.length), 4)

  return lines.map(
    (line) => `    ${line.name.padEnd(width)}  ${paint(line.detail, 'dim')}`,
  )
}

const renderEntry = (doc: TRecipeDoc): readonly string[] => [
  '',
  paint(doc.name, 'bold'),
  `  ${doc.summary}`,
  `  ${doc.usage}`,
  ...(doc.flags.length === 0 ? [] : ['  flags:', ...renderLines(doc.flags)]),
  ...(doc.env.length === 0 ? [] : ['  env:', ...renderLines(doc.env)]),
  ...(doc.examples.length === 0
    ? []
    : ['  examples:', ...doc.examples.map((example) => `    ${example}`)]),
]

const renderGlobalSection = (): readonly string[] => [
  '',
  paint('global flags and env', 'bold'),
  paint('  every recipe that reads a config or a db file honours these', 'dim'),
  ...renderLines(GLOBAL_FLAGS),
  ...renderLines(GLOBAL_ENV),
]

const renderCatalogueBlock = (view: THelpView): string =>
  view.catalogue === undefined
    ? [
        '',
        paint('catalogue', 'bold'),
        `  ${view.catalogueNote ?? 'the configuration could not be read'}`,
        '',
      ].join('\n')
    : renderCatalogue(view.catalogue)

export const renderHelp = (view: THelpView): string => {
  if (view.topic !== undefined) {
    return [...renderEntry(view.topic), ''].join('\n')
  }

  const groups = GROUPS.flatMap((group) => [
    '',
    paint(group, 'bold'),
    ...RECIPE_DOCS.filter((doc) => doc.group === group).flatMap(renderEntry),
  ])

  return [
    renderCatalogueBlock(view),
    ...renderGlobalSection(),
    ...groups,
    '',
    'just crust help <recipe> narrows this to one recipe.',
    '',
  ].join('\n')
}
