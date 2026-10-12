import { expect, test } from 'bun:test'
import { decodeKeys } from './ask'

const ESC = '\u001B'

test(
  [
    'given data/ask::decodeKeys',
    'when an arrow and an enter arrive in ONE read, as fast typing produces',
    'it should yield both rather than drop the chunk as unrecognised',
  ].join(' '),
  () => {
    // given
    const chunk = `${ESC}[B\r`

    // when
    const keys = decodeKeys(chunk)

    // then
    expect(keys).toEqual(['down', 'submit'])
  },
)

test(
  [
    'given data/ask::decodeKeys',
    'when a lone escape arrives',
    'it should cancel, because nothing follows it to make it an arrow',
  ].join(' '),
  () => {
    // given
    const chunk = ESC

    // when
    const keys = decodeKeys(chunk)

    // then
    expect(keys).toEqual(['cancel'])
  },
)

test(
  [
    'given data/ask::decodeKeys',
    'when an arrow key arrives',
    'it should NOT also read its leading escape as a cancel',
  ].join(' '),
  () => {
    // given
    const chunk = `${ESC}[A`

    // when
    const keys = decodeKeys(chunk)

    // then
    expect(keys).toEqual(['up'])
  },
)

test(
  [
    'given data/ask::decodeKeys',
    'when several selections and a submit are pasted together',
    'it should yield them in order',
  ].join(' '),
  () => {
    // given
    const chunk = `\t${ESC}[B\t\r`

    // when
    const keys = decodeKeys(chunk)

    // then
    expect(keys).toEqual(['toggle', 'down', 'toggle', 'submit'])
  },
)

test(
  [
    'given data/ask::decodeKeys',
    'when an unrecognised escape sequence arrives, such as a mouse report',
    'it should yield nothing rather than guess at enter',
  ].join(' '),
  () => {
    // given
    const chunk = `${ESC}[M abc`

    // when
    const keys = decodeKeys(chunk)

    // then
    expect(keys).toContain('toggle') // the literal space is a real key
    expect(keys).not.toContain('submit')
  },
)

test(
  [
    'given data/ask::decodeKeys',
    'when ctrl-c arrives',
    'it should cancel, so a wizard can always be escaped',
  ].join(' '),
  () => {
    // given
    const chunk = '\u0003'

    // when
    const keys = decodeKeys(chunk)

    // then
    expect(keys).toEqual(['cancel'])
  },
)

test(
  [
    'given data/ask::decodeKeys',
    'when vim-style j and k arrive',
    'it should keep them distinct, so a screen can decide what they mean',
  ].join(' '),
  () => {
    // given
    const chunk = 'jk'

    // when
    const keys = decodeKeys(chunk)

    // then — a menu reads these as the cursor; the ordering screen moves
    // the activity with them, which only works if the decoder kept them apart
    expect(keys).toEqual(['vimDown', 'vimUp'])
  },
)

test(
  [
    'given data/ask::decodeKeys',
    'when the capitals that used to move a activity arrive',
    'it should still accept them, for hands that learned them',
  ].join(' '),
  () => {
    // given
    const chunk = 'JK'

    // when
    const keys = decodeKeys(chunk)

    // then
    expect(keys).toEqual(['vimDown', 'vimUp'])
  },
)
