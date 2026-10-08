import { expect, test } from 'bun:test'
import type { TEnvelopeBase } from '../../typedefs/envelope'
import type { TRun } from '../../typedefs/run'
import { commitMessage, deliveryBranch, patchPath } from './commit-step'

const run = (runId: string, sessionDir = '/tmp/s'): TRun =>
  ({ runId, sessionDir }) as unknown as TRun

test(
  [
    'given use-cases/steps/commit-step::deliveryBranch',
    'when a run delivers onto a branch',
    'it should name the branch after the run that wrote it',
  ].join(', '),
  () => {
    // given
    const session = run('a1b2c3d4')

    // when
    const actual = deliveryBranch(session)

    // then — two runs delivering similar work would otherwise collide, and a
    // developer finding the branch could not tell which run produced it
    expect(actual).toBe('crust/a1b2c3d4')
  },
)

test(
  [
    'given use-cases/steps/commit-step::patchPath',
    'when the mode is patch',
    'it should write beside the session rather than into the repository',
  ].join(', '),
  () => {
    // given
    const session = run('a1b2c3d4', '/data/sessions/a1b2c3d4')

    // when
    const actual = patchPath(session)

    // then
    expect(actual).toBe('/data/sessions/a1b2c3d4/a1b2c3d4.patch')
  },
)

test(
  [
    'given use-cases/steps/commit-step::commitMessage',
    'when the envelope that wrote the code supplied a subject',
    'it should use the authoring agent\'s own words',
  ].join(', '),
  () => {
    // given
    const envelope = {
      status: 'success',
      summary: 'added the endpoint',
      commit_message: 'Add the /health endpoint',
    } as unknown as TEnvelopeBase

    // when
    const actual = commitMessage(run('a1b2c3d4'), envelope)

    // then
    expect(actual).toBe('Add the /health endpoint')
  },
)

test(
  [
    'given use-cases/steps/commit-step::commitMessage',
    'when no subject was written',
    'it should fall back to something traceable to the run',
  ].join(', '),
  () => {
    // given
    const envelope = {
      status: 'success',
      summary: 'added the endpoint',
    } as unknown as TEnvelopeBase

    // when
    const actual = commitMessage(run('a1b2c3d4'), envelope)

    // then — a message nobody wrote should at least say which run wrote it
    expect(actual).toBe('crust(a1b2c3d4): added the endpoint')
  },
)
