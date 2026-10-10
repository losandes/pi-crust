import { expect, test } from 'bun:test'
import { extractJson } from './extract-json'

test(
  [
    'given use-cases/extract-json::extractJson',
    'when the response is bare JSON',
    'it should parse it',
  ].join(', '),
  () => {
    // given
    const text = '{"status":"success","summary":"done"}'

    // when
    const actual = extractJson(text)

    // then
    expect(actual).toEqual({ status: 'success', summary: 'done' })
  },
)

test(
  [
    'given use-cases/extract-json::extractJson',
    'when the object arrives inside a fenced json block surrounded by prose',
    'it should prefer the fenced block',
  ].join(', '),
  () => {
    // given
    const text = [
      'Here is my report. {not: json}',
      '```json',
      '{"status":"success","summary":"fenced"}',
      '```',
      'Let me know if you need more.',
    ].join('\n')

    // when
    const actual = extractJson(text)

    // then
    expect(actual).toEqual({ status: 'success', summary: 'fenced' })
  },
)

test(
  [
    'given use-cases/extract-json::extractJson',
    'when prose wraps a bare object',
    'it should take the outermost braces',
  ].join(', '),
  () => {
    // given
    const text =
      'Sure thing!\n{"status":"fail","summary":"nested {braces} inside"}\nThanks.'

    // when
    const actual = extractJson(text)

    // then
    expect(actual).toEqual({
      status: 'fail',
      summary: 'nested {braces} inside',
    })
  },
)

test(
  [
    'given use-cases/extract-json::extractJson',
    'when the response contains no object at all',
    'it should throw a message naming the problem',
  ].join(', '),
  () => {
    // given
    const text = 'I could not complete the task.'

    // when, then
    expect(() => extractJson(text)).toThrow(/no JSON object found/)
  },
)
