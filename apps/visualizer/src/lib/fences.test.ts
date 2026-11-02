import { expect, test } from 'bun:test'
import { hasCode, hasFence, splitFences, splitFencesAndJson } from './fences'

test(
  [
    'given lib/fences::splitFences',
    'when the text has no fence at all',
    'it should return the whole thing as one prose segment',
  ].join(' '),
  () => {
    // given
    const text = 'I looked at the router and it is fine.'

    // when
    const segments = splitFences(text)

    // then
    expect(segments).toEqual([
      { kind: 'prose', text, language: '', open: false },
    ])
  },
)

test(
  [
    'given lib/fences::splitFences',
    'when a closed fence sits between two paragraphs',
    'it should return prose, code, prose and carry the language',
  ].join(' '),
  () => {
    // given
    const text = 'Here is the call:\n```ts\nconst a = 1\n```\nand that is all.'

    // when
    const segments = splitFences(text)

    // then
    expect(segments.map((segment) => segment.kind)).toEqual([
      'prose',
      'code',
      'prose',
    ])
    expect(segments[1]?.language).toBe('ts')
    expect(segments[1]?.text).toBe('const a = 1')
  },
)

test(
  [
    'given lib/fences::splitFences',
    'when the fence is still being streamed and has no closing line',
    'it should return the code so far, flagged open',
  ].join(' '),
  () => {
    // given
    const text = 'Writing it now:\n```json\n{ "a": 1 },'

    // when
    const segments = splitFences(text)

    // then
    expect(segments[1]).toEqual({
      kind: 'code',
      text: '{ "a": 1 },',
      language: 'json',
      open: true,
    })
  },
)

test(
  [
    'given lib/fences::splitFences',
    'when the fence carries no info string',
    'it should keep the code and leave the language empty',
  ].join(' '),
  () => {
    // given
    const text = '```\njust crust sdlc\n```'

    // when
    const segments = splitFences(text)

    // then
    expect(segments).toEqual([
      { kind: 'code', text: 'just crust sdlc', language: '', open: false },
    ])
  },
)

test(
  [
    'given lib/fences::splitFences',
    'when the info string is in mixed case',
    'it should lowercase it, so one highlighter branch serves TS and ts',
  ].join(' '),
  () => {
    // given
    const text = '```JSON\n{}\n```'

    // when
    const segments = splitFences(text)

    // then
    expect(segments[0]?.language).toBe('json')
  },
)

test(
  [
    'given lib/fences::splitFences',
    'when blank lines surround a fence',
    'it should drop them rather than emit empty prose between segments',
  ].join(' '),
  () => {
    // given
    const text = 'one\n\n```\ntwo\n```\n\nthree'

    // when
    const segments = splitFences(text)

    // then
    expect(segments.map((segment) => segment.text)).toEqual([
      'one',
      'two',
      'three',
    ])
  },
)

test(
  [
    'given lib/fences::splitFences',
    'when one narration holds two code blocks',
    'it should keep them separate rather than merge across the gap',
  ].join(' '),
  () => {
    // given
    const text = '```\na\n```\nmid\n```\nb\n```'

    // when
    const segments = splitFences(text)

    // then
    expect(
      segments.map((segment) => `${segment.kind}:${segment.text}`),
    ).toEqual(['code:a', 'prose:mid', 'code:b'])
  },
)

test(
  [
    'given lib/fences::splitFences',
    'when the fenced code is indented',
    'it should preserve the indentation, which is the point of a code block',
  ].join(' '),
  () => {
    // given
    const text = '```ts\nif (a) {\n  b()\n}\n```'

    // when
    const segments = splitFences(text)

    // then
    expect(segments[0]?.text).toBe('if (a) {\n  b()\n}')
  },
)

test(
  [
    'given lib/fences::hasFence',
    'when the prose only mentions an inline backtick span',
    'it should be false, because a single backtick is not a fence',
  ].join(' '),
  () => {
    // given
    const text = 'the `run_id` column'

    // when
    const fenced = hasFence(text)

    // then
    expect(fenced).toBe(false)
  },
)

test(
  [
    'given lib/fences::hasFence',
    'when the text contains a triple backtick',
    'it should be true',
  ].join(' '),
  () => {
    // given
    const text = 'see:\n```\nx\n```'

    // when
    const fenced = hasFence(text)

    // then
    expect(fenced).toBe(true)
  },
)

test(
  [
    'given lib/fences::splitFencesAndJson',
    'when a turn pastes its report with no fence around it',
    'it should read as code, because that is what the reader sees',
  ].join(', '),
  () => {
    // given — agents paste the envelope bare more often than they fence it,
    // and always as the last message of a turn, which is where the eye is
    const source =
      'Here is my report.\n{\n  "status": "success",\n  "summary": "done"\n}'

    // when
    const actual = splitFencesAndJson(source)

    // then
    expect(actual.map((part) => part.kind)).toEqual(['prose', 'code'])
    expect(actual[1]?.language).toBe('json')
    expect(actual[1]?.text.startsWith('{')).toBe(true)
  },
)

test(
  [
    'given lib/fences::splitFencesAndJson',
    'when prose merely contains braces',
    'it should stay prose, because the test is JSON.parse and not a pattern',
  ].join(', '),
  () => {
    // given — an agent writing about code writes braces constantly
    const source = 'I will set { timeout: 30 } on the client and move on.'

    // when
    const actual = splitFencesAndJson(source)

    // then
    expect(actual.map((part) => part.kind)).toEqual(['prose'])
  },
)

test(
  [
    'given lib/fences::splitFencesAndJson',
    'when the object is cut off before it closes',
    'it should still read as code, flagged open',
  ].join(', '),
  () => {
    // given — narration is capped, and EVERY bare report in the trace hit
    // the cap. Requiring a closing brace meant the exact blocks this exists
    // for were the ones it ignored.
    const source = 'Report:\n{\n  "status": "suc'

    // when
    const actual = splitFencesAndJson(source)

    // then
    expect(actual.map((part) => part.kind)).toEqual(['prose', 'code'])
    expect(actual[1]?.open).toBe(true)
  },
)

test(
  [
    'given lib/fences::splitFencesAndJson',
    'when an unterminated brace is not shaped like JSON',
    'it should stay prose, which is what keeps the open case honest',
  ].join(', '),
  () => {
    // given — accepting anything unterminated would turn half the prose in
    // the pane into code. The shape test is: a quoted key, then a colon. The
    // brace sits at the start of a line, so the scan reaches the shape test
    // rather than failing earlier on where the brace appears.
    const source = 'Config:\n{\n  timeout: 30'

    // when
    const actual = splitFencesAndJson(source)

    // then
    expect(actual.map((part) => part.kind)).toEqual(['prose'])
  },
)

test(
  [
    'given lib/fences::splitFencesAndJson',
    'when a brace sits inside a JSON string value',
    'it should not end the block early on it',
  ].join(', '),
  () => {
    // given — the factory's own evidence strings quote shell and code, so a
    // naive brace count ends the block in the middle of a sentence
    const source =
      '{\n  "evidence": "ran `awk \'{print $1}\'` and it exited 0"\n}'

    // when
    const actual = splitFencesAndJson(source)

    // then
    expect(actual.map((part) => part.kind)).toEqual(['code'])
    expect(actual[0]?.text.endsWith('}')).toBe(true)
    expect(JSON.parse(actual[0]?.text ?? '')).toHaveProperty('evidence')
  },
)

test(
  [
    'given lib/fences::splitFencesAndJson',
    'when an explicit fence already wraps the JSON',
    'it should leave it alone rather than splitting inside it',
  ].join(', '),
  () => {
    // given
    const source = '```json\n{ "a": 1 }\n```'

    // when
    const actual = splitFencesAndJson(source)

    // then
    expect(actual.length).toBe(1)
    expect(actual[0]?.kind).toBe('code')
  },
)

test(
  [
    'given lib/fences::splitFencesAndJson',
    'when two objects are pasted with a sentence between them',
    'it should promote both, not only the first',
  ].join(', '),
  () => {
    // given
    const source = '{ "a": 1 }\nthen I checked again\n{ "b": 2 }'

    // when
    const actual = splitFencesAndJson(source)

    // then
    expect(actual.map((part) => part.kind)).toEqual(['code', 'prose', 'code'])
  },
)

test(
  [
    'given lib/fences::splitFencesAndJson',
    'when a JSON string contains an escaped quote',
    'it should not treat the escaped quote as ending the string',
  ].join(', '),
  () => {
    // given — the escape must be tracked, or the quote inside closes the
    // string early and the next real quote reopens it in the wrong place
    const source = '{\n  "quote": "he said \\"hi\\" to me"\n}'

    // when
    const actual = splitFencesAndJson(source)

    // then
    expect(actual.map((part) => part.kind)).toEqual(['code'])
    expect(JSON.parse(actual[0]?.text ?? '')).toEqual({
      quote: 'he said "hi" to me',
    })
  },
)

test(
  [
    'given lib/fences::splitFencesAndJson',
    'when the braces balance but the content is not valid JSON',
    'it should fall back to prose rather than throw',
  ].join(', '),
  () => {
    // given — single-quoted keys balance the braces the scanner counts, but
    // JSON.parse rejects them
    const source = "{ 'a': 1 }"

    // when
    const actual = splitFencesAndJson(source)

    // then
    expect(actual.map((part) => part.kind)).toEqual(['prose'])
  },
)

test(
  [
    'given lib/fences::hasCode',
    'when the text has neither a fence nor an embedded JSON value',
    'it should say there is no code',
  ].join(', '),
  () => {
    // given
    const source = 'just a sentence, no code at all'

    // when
    const actual = hasCode(source)

    // then
    expect(actual).toBe(false)
  },
)

test(
  [
    'given lib/fences::hasCode',
    'when the text has a fence or an embedded JSON value',
    'it should say there is code',
  ].join(', '),
  () => {
    // given
    const fenced = '```js\nconst x = 1\n```'
    const json = '{\n  "a": 1\n}'

    // when
    const actual = [hasCode(fenced), hasCode(json)]

    // then
    expect(actual).toEqual([true, true])
  },
)
