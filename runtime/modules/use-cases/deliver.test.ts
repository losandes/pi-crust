import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TEnvelopeBase } from '../typedefs/envelope'
import type { TRun } from '../typedefs/run'
import { commitActivity, commitMessage } from './deliver'

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/**
 * A repository with one commit, so HEAD exists and a second commit can be
 * told from the first.
 */
const aRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-deliver-'))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'tester@example.com')
  git(dir, 'config', 'user.name', 'tester')
  writeFileSync(join(dir, 'README.md'), 'before\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'first')

  return dir
}

const runIn = (): TRun =>
  ({
    runId: 'aaaa1111',
    console: { note: () => undefined },
    tracer: { event: () => undefined },
  }) as unknown as TRun

const envelopeWith = (message: string): TEnvelopeBase =>
  ({
    status: 'success',
    summary: 'implemented the thing',
    artifacts: [],
    notes_for_next_agent: '',
    commit_message: message,
  }) as unknown as TEnvelopeBase

/** `commitAll` shells out in the process's cwd, so the test stands there. */
const inRepo = <TResult>(dir: string, body: () => TResult): TResult => {
  const was = process.cwd()
  process.chdir(dir)
  try {
    return body()
  } finally {
    process.chdir(was)
  }
}

test(
  [
    'given use-cases/deliver::commitActivity',
    'when an Activity that declared commit has changed the tree',
    "it should commit it in the envelope's own words",
  ].join(', '),
  () => {
    /*
     * given — granularity follows the chain: several writing Activities
     * produce several commits, each in the words of the envelope that
     * wrote it, rather than one squashed `commitAll` at the end.
     */
    const dir = aRepo()
    writeFileSync(join(dir, 'README.md'), 'after\n')

    // when
    const actual = inRepo(dir, () =>
      commitActivity(runIn(), 'build', 'id', envelopeWith('feat: the thing')),
    )

    // then
    expect(actual).not.toEqual('')
    expect(git(dir, 'log', '-1', '--pretty=%s')).toEqual('feat: the thing')
  },
)

test(
  [
    'given use-cases/deliver::commitActivity',
    'when the Activity changed no tracked file',
    'it should commit nothing rather than fail on an empty change',
  ].join(', '),
  () => {
    // given — an Activity whose gates passed without touching the repo has
    // done its job; demanding a commit would make that an error
    const dir = aRepo()

    // when
    const actual = inRepo(dir, () =>
      commitActivity(runIn(), 'review', 'id', envelopeWith('chore: nothing')),
    )

    // then
    expect(actual).toEqual('')
    expect(git(dir, 'log', '--oneline')).not.toContain('chore: nothing')
  },
)

test(
  [
    'given use-cases/deliver::commitMessage',
    'when the envelope that wrote the code supplied no subject',
    'it should fall back to something traceable to the run',
  ].join(', '),
  () => {
    // given
    const given = envelopeWith('')

    // when
    const actual = commitMessage(runIn(), given)

    // then
    expect(actual).toEqual('crust(aaaa1111): implemented the thing')
  },
)
