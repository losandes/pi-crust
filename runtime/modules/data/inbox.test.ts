import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inboxPath, inboxSince, postToInbox, readInbox } from './inbox'

const workspace = (): string => mkdtempSync(join(tmpdir(), 'crust-inbox-'))

test(
  [
    'given data/inbox::postToInbox',
    'when two people say something to the same run',
    'it should keep both, in the order they said them',
  ].join(', '),
  () => {
    // given
    const dir = workspace()

    // when
    postToInbox(dir, 'steer', 'use the existing table', 'andy')
    postToInbox(dir, 'follow_up', 'then write it up', 'the web app')

    // then — a steering message is part of what happened to the run, so
    // nothing is ever rewritten or dropped
    const actual = readInbox(dir)
    expect(actual.map((entry) => entry.message)).toEqual([
      'use the existing table',
      'then write it up',
    ])
    expect(actual.map((entry) => entry.from)).toEqual(['andy', 'the web app'])
    rmSync(dir, { recursive: true, force: true })
  },
)

test(
  [
    'given data/inbox::inboxSince',
    'when the run has already consumed what was there',
    'it should deliver only what arrived afterwards',
  ].join(', '),
  () => {
    // given — an activity run that started after an earlier message was handled
    const dir = workspace()
    postToInbox(dir, 'steer', 'old news', 'andy')
    const first = inboxSince(dir, 0)

    // when
    postToInbox(dir, 'steer', 'new instruction', 'andy')
    const actual = inboxSince(dir, first.consumed)

    // then — redelivering a message would steer an agent twice on one request
    expect(actual.messages.map((entry) => entry.message)).toEqual([
      'new instruction',
    ])
    rmSync(dir, { recursive: true, force: true })
  },
)

test(
  [
    'given data/inbox::readInbox',
    'when the reader catches the writer mid-append',
    'it should skip the partial line rather than throwing',
  ].join(', '),
  () => {
    // given — a poll landing between two writes of a line
    const dir = workspace()
    postToInbox(dir, 'steer', 'complete', 'andy')
    writeFileSync(inboxPath(dir), `${'{"kind":"steer","mess'}`, { flag: 'a' })

    // when
    const actual = readInbox(dir)

    // then — the line will be whole next time, and the cursor has not passed it
    expect(actual.map((entry) => entry.message)).toEqual(['complete'])
    rmSync(dir, { recursive: true, force: true })
  },
)

test(
  [
    'given data/inbox::readInbox',
    'when a line parses but is not a message this run understands',
    'it should ignore it rather than delivering a malformed instruction',
  ].join(', '),
  () => {
    // given — anything may append to a file on disk
    const dir = workspace()
    writeFileSync(inboxPath(dir), '{"kind":"explode","message":"now"}\n')

    // when
    const actual = readInbox(dir)

    // then
    expect(actual).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  },
)

test(
  [
    'given data/inbox::inboxSince',
    'when nothing has ever been posted',
    'it should report an empty inbox rather than failing on a missing file',
  ].join(', '),
  () => {
    // given — the common case: almost no run is ever steered
    const dir = workspace()

    // when
    const actual = inboxSince(dir, 0)

    // then
    expect(actual).toEqual({ messages: [], consumed: 0 })
    rmSync(dir, { recursive: true, force: true })
  },
)
