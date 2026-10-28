/**
 * The way into a run that is already working.
 *
 * A run is one process and whoever wants to steer it is another — a web app, a
 * second terminal, a script. They share a filesystem and nothing else, so the
 * message lands in a file the run watches rather than in a socket somebody has
 * to keep open.
 *
 * Append-only JSONL, one message per line, with a cursor the run keeps to
 * itself. Nothing is ever deleted or rewritten: a steering message is part of
 * what happened to the run, and a reader comparing the trace against the
 * transcript should be able to see what was said and when.
 *
 * Writes are appends of a single line, which is atomic enough for this — two
 * writers interleaving whole lines is fine, and no reader ever rewrites the
 * file.
 */

import { join } from 'node:path'
import { nowIso } from './clock'
import { appendText, fileExists, readText } from './files'

export const INBOX_FILENAME = 'inbox.jsonl'

/** What someone can say to a run in flight. */
export type TInboxKind = 'steer' | 'follow_up' | 'abort'

export type TInboxMessage = Readonly<{
  kind: TInboxKind
  /** Empty for `abort`, which carries no text. */
  message: string
  at: string
  /** Who sent it, for the trace — a person's name, or the app that posted it. */
  from: string
}>

export const inboxPath = (sessionDir: string): string =>
  join(sessionDir, INBOX_FILENAME)

const isKind = (value: unknown): value is TInboxKind =>
  value === 'steer' || value === 'follow_up' || value === 'abort'

/** Post a message to a run. Returns the line as written. */
export const postToInbox = (
  sessionDir: string,
  kind: TInboxKind,
  message: string,
  from: string,
): TInboxMessage => {
  const entry: TInboxMessage = { kind, message, at: nowIso(), from }
  appendText(inboxPath(sessionDir), `${JSON.stringify(entry)}\n`)
  return entry
}

/**
 * Every message in the file, in order, tolerating a partial last line.
 *
 * A reader can catch the writer mid-append, so an unparseable line is skipped
 * rather than throwing — it will be complete by the next poll, and the cursor
 * has not moved past it.
 */
export const readInbox = (sessionDir: string): readonly TInboxMessage[] => {
  const path = inboxPath(sessionDir)
  if (!fileExists(path)) return []
  return readText(path)
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      // biome-ignore lint/plugin: this layer owns the boundary
      try {
        const parsed: unknown = JSON.parse(line)
        if (parsed === null || typeof parsed !== 'object') return []
        const entry = parsed as Partial<TInboxMessage>
        if (!isKind(entry.kind)) return []
        return [
          {
            kind: entry.kind,
            message: typeof entry.message === 'string' ? entry.message : '',
            at: typeof entry.at === 'string' ? entry.at : '',
            from: typeof entry.from === 'string' ? entry.from : 'unknown',
          },
        ]
      } catch (cause) {
        /*
         * A line still being written. It will be whole on the next read, and
         * the cursor has not passed it, so there is nothing to report.
         */
        void cause
        return []
      }
    })
}

/**
 * What has arrived since the run last looked, and where to look from next.
 *
 * The cursor is a COUNT of messages consumed rather than a byte offset: a
 * partial final line changes the byte length without adding a message, and a
 * byte cursor would skip it once it completed.
 */
export const inboxSince = (
  sessionDir: string,
  consumed: number,
): Readonly<{ messages: readonly TInboxMessage[]; consumed: number }> => {
  const all = readInbox(sessionDir)
  return { messages: all.slice(consumed), consumed: all.length }
}
