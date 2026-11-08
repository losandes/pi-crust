import { afterAll, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  changed,
  diffHandoff,
  readAll,
  restoreAll,
  snapshotHandoff,
} from './handoff-snapshot'

afterAll(() => {
  // mock.module() leaks across files in bun's shared module registry
  // (https://bun.sh/docs/test/parallel); restore the real module explicitly
  // rather than rely on mock.restore(), which does not undo it.
  mock.module('node:fs', () => require('node:fs'))
})

const scratch = (): string => mkdtempSync(join(tmpdir(), 'crust-handoff-'))

test(
  [
    'given data/handoff-snapshot::diffHandoff',
    'when a activity rewrites a file to different content of the same length',
    'it should report it as modified',
  ].join(', '),
  () => {
    // given — the case a directory listing cannot see, and the one worth
    // catching: design.md still exists, with somebody else's design in it
    const dir = scratch()
    writeFileSync(join(dir, 'design.md'), 'AAAA')
    const before = snapshotHandoff(dir)

    // when
    writeFileSync(join(dir, 'design.md'), 'BBBB')
    const actual = diffHandoff(before, snapshotHandoff(dir))

    // then
    expect(actual).toEqual({
      created: [],
      modified: ['design.md'],
      deleted: [],
    })
  },
)

test(
  [
    'given data/handoff-snapshot::diffHandoff',
    'when a activity creates, deletes and leaves files alone',
    'it should separate what it made from what it took',
  ].join(', '),
  () => {
    // given — creation is a activity's own output; deletion is damage to another
    // activity's, and the two must never be reported as the same thing
    const dir = scratch()
    writeFileSync(join(dir, 'plan.md'), 'plan')
    writeFileSync(join(dir, 'scout_findings.md'), 'findings')
    const before = snapshotHandoff(dir)

    // when
    writeFileSync(join(dir, 'design.md'), 'design')
    rmSync(join(dir, 'plan.md'))

    // then
    expect(diffHandoff(before, snapshotHandoff(dir))).toEqual({
      created: ['design.md'],
      modified: [],
      deleted: ['plan.md'],
    })
  },
)

test(
  [
    'given data/handoff-snapshot::snapshotHandoff',
    'when an agent writes into a subdirectory',
    'it should see the files there too',
  ].join(', '),
  () => {
    // given — an agent told to write "a document" may well make a folder for
    // it, and a top-level-only snapshot reports the whole subtree as nothing
    const dir = scratch()
    mkdirSync(join(dir, 'research'), { recursive: true })
    writeFileSync(join(dir, 'research', 'sources.md'), 'sources')

    // when
    const actual = snapshotHandoff(dir)

    // then
    expect([...actual.keys()]).toEqual(['research/sources.md'])
  },
)

test(
  [
    'given data/handoff-snapshot::snapshotHandoff',
    'when the directory does not exist yet',
    'it should read as empty rather than throwing',
  ].join(', '),
  () => {
    // given — the first activityRun of a run can start before anything has been
    // written, and observation must never be what fails an activity run
    const missing = join(scratch(), 'not-created-yet')

    // when
    const actual = snapshotHandoff(missing)

    // then
    expect([...actual.keys()]).toEqual([])
    expect(changed(diffHandoff(actual, actual))).toEqual(false)
  },
)

test(
  [
    'given data/handoff-snapshot::readAll',
    'when copies are taken before an activity run runs',
    'it should hold the bytes needed to undo damage git cannot',
  ].join(', '),
  () => {
    // given — the session directory is gitignored, which is both why an agent
    // may write there and why nothing could restore it
    const dir = scratch()
    writeFileSync(join(dir, 'design.md'), 'the original design')

    // when
    const copies = readAll(dir, ['design.md', 'never-existed.md'])

    // then
    expect([...copies.keys()]).toEqual(['design.md'])
    expect(copies.get('design.md')?.toString()).toEqual('the original design')
  },
)

test(
  [
    'given data/handoff-snapshot::snapshotHandoff',
    'when a file in the directory cannot be read',
    'it should skip it rather than fail the activity run it watches',
  ].join(', '),
  () => {
    // given — mocked, because provoking a real unreadable entry mid-listing
    // needs a race this test cannot depend on
    const dir = scratch()
    writeFileSync(join(dir, 'design.md'), 'content')
    const real = require('node:fs')
    mock.module('node:fs', () => ({
      ...real,
      readFileSync: () => {
        throw new Error('vanished mid-listing')
      },
    }))

    // when
    const actual = snapshotHandoff(dir)

    // then
    expect(actual.size).toBe(0)
    mock.module('node:fs', () => require('node:fs'))
  },
)

test(
  [
    'given data/handoff-snapshot::snapshotHandoff',
    'when the directory itself disappears between the check and the walk',
    'it should yield an empty snapshot rather than throw',
  ].join(', '),
  () => {
    // given
    const real = require('node:fs')
    mock.module('node:fs', () => ({
      ...real,
      readdirSync: () => {
        throw new Error('ENOENT: no such directory')
      },
    }))

    // when
    const actual = snapshotHandoff('/some/dir')

    // then
    expect(actual.size).toBe(0)
    mock.module('node:fs', () => require('node:fs'))
  },
)

test(
  [
    'given data/handoff-snapshot::restoreAll',
    'when a copy cannot be written back',
    'it should report it as not restored rather than throw',
  ].join(', '),
  () => {
    // given
    const real = require('node:fs')
    mock.module('node:fs', () => ({
      ...real,
      chmodSync: () => {
        throw new Error('EPERM')
      },
    }))
    const originals = new Map([['design.md', Buffer.from('original')]])

    // when
    const actual = restoreAll('/some/dir', originals, ['design.md'])

    // then
    expect(actual).toEqual([])
    mock.module('node:fs', () => require('node:fs'))
  },
)
