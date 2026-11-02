import { expect, test } from 'bun:test'
import { escapeHtml, highlightJson, highlightJsonText } from './highlight'

test(
  [
    'given lib/highlight::escapeHtml',
    'when the input carries every character with HTML meaning',
    'it should escape all of them',
  ].join(', '),
  () => {
    // given
    const input = `<a href="x">'&'</a>`

    // when
    const actual = escapeHtml(input)

    // then
    expect(actual).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  },
)

test(
  [
    'given lib/highlight::highlightJsonText',
    'when the text contains an object key, a string value, a bool, null, and a number',
    'it should wrap each in its token class and escape everything else',
  ].join(', '),
  () => {
    // given
    const text = '{"a": "b", "t": true, "n": null, "x": -1.5e3}'

    // when
    const actual = highlightJsonText(text)

    // then — the quote characters inside tokens are HTML-escaped too
    expect(actual).toContain('<span class="j-key">&quot;a&quot;</span>:')
    expect(actual).toContain('<span class="j-str">&quot;b&quot;</span>')
    expect(actual).toContain('<span class="j-bool">true</span>')
    expect(actual).toContain('<span class="j-null">null</span>')
    expect(actual).toContain('<span class="j-num">-1.5e3</span>')
  },
)

test(
  [
    'given lib/highlight::highlightJson',
    'when the input is absent',
    'it should render as empty',
  ].join(', '),
  () => {
    // given
    const raw = null

    // when
    const actual = highlightJson(raw)

    // then
    expect(actual).toBe('')
  },
)

test(
  [
    'given lib/highlight::highlightJson',
    'when the input parses as JSON',
    'it should pretty-print and highlight it',
  ].join(', '),
  () => {
    // given
    const raw = '{"a":1}'

    // when
    const actual = highlightJson(raw)

    // then
    expect(actual).toContain('<span class="j-key">&quot;a&quot;</span>:')
    expect(actual).toContain('<span class="j-num">1</span>')
  },
)

test(
  [
    'given lib/highlight::highlightJson',
    'when the input does not parse as JSON',
    'it should fall back to escaped raw text',
  ].join(', '),
  () => {
    // given
    const raw = '<not json>'

    // when
    const actual = highlightJson(raw)

    // then
    expect(actual).toBe('&lt;not json&gt;')
  },
)
