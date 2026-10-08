import { expect, test } from 'bun:test'
import { renderMarkdown } from './markdown'

test(
  [
    'given lib/markdown::renderMarkdown',
    'when a document contains a pipe table',
    'it should render a table, honouring the declared alignment',
  ].join(', '),
  () => {
    // given — the architects produce these constantly: a comparison of
    // candidate approaches IS a table, and as paragraphs it was a wall of
    // pipes to be parsed by eye
    const source = [
      '| Approach | Cost | Verdict |',
      '| --- | :---: | ---: |',
      '| Shared db | low | rejected |',
    ].join('\n')

    // when
    const actual = renderMarkdown(source)

    // then
    expect(actual).toContain('<table class="md-table">')
    expect(actual).toContain('<th>Approach</th>')
    expect(actual).toContain('<th style="text-align:center">Cost</th>')
    expect(actual).toContain('<th style="text-align:right">Verdict</th>')
    expect(actual).toContain('<td>Shared db</td>')
  },
)

test(
  [
    'given lib/markdown::renderMarkdown',
    'when prose merely contains a pipe',
    'it should stay a paragraph',
  ].join(', '),
  () => {
    // given — a shell pipeline or an either/or is not a table, and promoting
    // the first pipe to a header would eat the paragraph after it. The
    // delimiter row is what proves it, which is why detection looks ahead.
    const source = 'Run cat x | wc -l to count them.\nAnd this follows.'

    // when
    const actual = renderMarkdown(source)

    // then
    expect(actual).not.toContain('<table')
    expect(actual).toContain('<p>')
  },
)

test(
  [
    'given lib/markdown::renderMarkdown',
    'when a table cell carries markup or inline formatting',
    'it should format the emphasis and escape the markup',
  ].join(', '),
  () => {
    // given — a table is rendered from a document a model wrote, so it must
    // not become the one block that lets a tag through
    const source = [
      '| what | note |',
      '| --- | --- |',
      '| `code` | **bold** and <img src=x onerror=alert(1)> |',
    ].join('\n')

    // when
    const actual = renderMarkdown(source)

    // then
    expect(actual).toContain('<code>code</code>')
    expect(actual).toContain('<strong>bold</strong>')
    expect(actual).not.toContain('<img')
    expect(actual).toContain('&lt;img')
  },
)

test(
  [
    'given lib/markdown::renderMarkdown',
    'when a table has no outer pipes and an empty cell',
    'it should still line the columns up',
  ].join(', '),
  () => {
    // given — both spellings are ordinary markdown, and an empty cell is how
    // a comparison says "nothing here"
    const source = ['a | b', '--- | ---', '1 | ', '2 | 3'].join('\n')

    // when
    const actual = renderMarkdown(source)

    // then
    expect(actual).toContain('<th>a</th><th>b</th>')
    expect(actual).toContain('<td>1</td><td></td>')
    expect(actual).toContain('<td>2</td><td>3</td>')
  },
)

test(
  [
    'given lib/markdown::renderMarkdown',
    'when a cell contains an escaped pipe',
    'it should keep the cell whole and show the pipe',
  ].join(', '),
  () => {
    // given — the only way to write a pipe inside a cell, and a design
    // documenting a union type does exactly this. Splitting on it turned a
    // three-column row into eight and the table came apart below that line;
    // found by rendering every document in the trace, not by a unit test.
    const source = [
      '| column | type |',
      '| --- | --- |',
      '| uri | `a \\| b \\| c` |',
    ].join('\n')

    // when
    const actual = renderMarkdown(source)

    // then
    expect(actual).toContain('<td>uri</td><td><code>a | b | c</code></td>')
  },
)
