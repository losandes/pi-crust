import { expect, test } from 'bun:test'
import { appendFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  forgetWorkspaces,
  readRegistry,
  registerWorkspace,
  registryPath,
} from './workspace-registry'

const scratch = (): string => mkdtempSync(join(tmpdir(), 'crust-registry-'))

test(
  [
    'given data/workspace-registry::registerWorkspace',
    'when runs start in two trees',
    'it should record each once, however many times they run',
  ].join(', '),
  () => {
    // given — a run registers on the way up, every time, so the file would
    // grow without bound if a repeat wrote a line
    const path = join(scratch(), 'workspaces.jsonl')
    const env = { CRUST_REGISTRY: path }

    // when
    registerWorkspace('/trees/a', '/trees/a/.pi-crust/data/crust.db', env)
    registerWorkspace('/trees/a', '/trees/a/.pi-crust/data/crust.db', env)
    registerWorkspace('/trees/b', '/trees/b/.pi-crust/data/crust.db', env)

    // then
    expect(readRegistry(path).map((entry) => entry.root)).toEqual([
      '/trees/a',
      '/trees/b',
    ])
  },
)

test(
  [
    'given data/workspace-registry::readRegistry',
    'when a line is half written or unreadable',
    'it should skip it and still return the rest',
  ].join(', '),
  () => {
    // given — a reader can catch a writer mid-append, and refusing to start
    // over one torn line would make the observer less reliable than no
    // registry at all
    const path = join(scratch(), 'workspaces.jsonl')
    const env = { CRUST_REGISTRY: path }
    registerWorkspace('/trees/a', '/trees/a/.pi-crust/data/crust.db', env)
    appendFileSync(path, '{"root":"/trees/b","db":"/trees/b/.pi')

    // when
    const actual = readRegistry(path)

    // then
    expect(actual.map((entry) => entry.root)).toEqual(['/trees/a'])
  },
)

test(
  [
    'given data/workspace-registry::forgetWorkspaces',
    'when a tree is forgotten by root or by database',
    'it should drop only that one and leave the file usable',
  ].join(', '),
  () => {
    // given — forgetting is explicit and never automatic: a tree whose
    // database cannot be opened looks the same as one on an unmounted volume
    const path = join(scratch(), 'workspaces.jsonl')
    const env = { CRUST_REGISTRY: path }
    registerWorkspace('/trees/a', '/trees/a/.pi-crust/data/crust.db', env)
    registerWorkspace('/trees/b', '/trees/b/.pi-crust/data/crust.db', env)
    registerWorkspace('/trees/c', '/trees/c/.pi-crust/data/crust.db', env)

    // when
    const kept = forgetWorkspaces(
      ['/trees/a', '/trees/c/.pi-crust/data/crust.db'],
      path,
    )

    // then
    expect(kept.map((entry) => entry.root)).toEqual(['/trees/b'])
    expect(readRegistry(path).map((entry) => entry.root)).toEqual(['/trees/b'])
  },
)

test(
  [
    'given data/workspace-registry::registryPath',
    'when no override is set',
    'it should live outside every repository, on the machine',
  ].join(', '),
  () => {
    // given — it lists places on THIS machine. Committed to a repository it
    // would be shared with people whose paths differ, and wrong for all.
    const env = { HOME: '/home/someone' }

    // when
    const actual = [
      registryPath(env),
      registryPath({ ...env, CRUST_REGISTRY: '/tmp/x.jsonl' }),
    ]

    // then
    expect(actual).toEqual([
      '/home/someone/.pi-crust/workspaces.jsonl',
      '/tmp/x.jsonl',
    ])
  },
)
