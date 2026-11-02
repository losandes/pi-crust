import { expect, test } from 'bun:test'
import { join, resolve } from 'node:path'
import {
  defaultHandoffDir,
  isSharedHandoffDir,
  resolveHandoffDir,
} from './handoff-location'

test(
  [
    'given use-cases/handoff-location::resolveHandoffDir',
    'when no --handoff override was given',
    "it should land on exactly today's path",
  ].join(', '),
  () => {
    // given
    const params = {
      repoRoot: '/repo',
      dataDir: '.pi-crust/data',
      runId: 'a1b2c3d4',
      override: undefined,
    }

    // when
    const actual = resolveHandoffDir(params)

    // then
    expect(actual).toEqual(defaultHandoffDir('.pi-crust/data', 'a1b2c3d4'))
    expect(actual).toEqual(
      resolve(
        join('.pi-crust/data', 'sessions', 'a1b2c3d4', 'context_handoff'),
      ),
    )
  },
)

test(
  [
    'given use-cases/handoff-location::resolveHandoffDir',
    'when the override contains {session_id}',
    'it should expand it to the run id',
  ].join(', '),
  () => {
    const actual = resolveHandoffDir({
      repoRoot: '/repo',
      dataDir: '.pi-crust/data',
      runId: 'a1b2c3d4',
      override: 'specs/{session_id}',
    })

    expect(actual).toEqual(resolve('/repo/specs/a1b2c3d4'))
  },
)

test(
  [
    'given use-cases/handoff-location::resolveHandoffDir',
    'when the override contains {run_id}',
    'it should expand it the same as {session_id}, because the codebase calls it run_id everywhere else',
  ].join(', '),
  () => {
    const actual = resolveHandoffDir({
      repoRoot: '/repo',
      dataDir: '.pi-crust/data',
      runId: 'a1b2c3d4',
      override: 'specs/{run_id}',
    })

    expect(actual).toEqual(resolve('/repo/specs/a1b2c3d4'))
  },
)

test(
  [
    'given use-cases/handoff-location::resolveHandoffDir',
    'when a relative override has no token at all',
    'it should resolve against the repo root, not process.cwd() and not data_dir',
  ].join(', '),
  () => {
    const actual = resolveHandoffDir({
      repoRoot: '/repo',
      dataDir: '.pi-crust/data',
      runId: 'a1b2c3d4',
      override: 'specs/current',
    })

    expect(actual).toEqual(resolve('/repo/specs/current'))
  },
)

test(
  [
    'given use-cases/handoff-location::resolveHandoffDir',
    'when the override is absolute',
    'it should be used as given',
  ].join(', '),
  () => {
    const actual = resolveHandoffDir({
      repoRoot: '/repo',
      dataDir: '.pi-crust/data',
      runId: 'a1b2c3d4',
      override: '/elsewhere/specs/{session_id}',
    })

    expect(actual).toEqual(resolve('/elsewhere/specs/a1b2c3d4'))
  },
)

test(
  [
    'given use-cases/handoff-location::resolveHandoffDir',
    'when the override is an empty string',
    'it should throw rather than silently fall back to the default',
  ].join(', '),
  () => {
    expect(() =>
      resolveHandoffDir({
        repoRoot: '/repo',
        dataDir: '.pi-crust/data',
        runId: 'a1b2c3d4',
        override: '',
      }),
    ).toThrow()
  },
)

test(
  [
    'given use-cases/handoff-location::isSharedHandoffDir',
    'when the resolved path carries no run id',
    'it should say so, because another run pointed at it would share it',
  ].join(', '),
  () => {
    expect(isSharedHandoffDir(resolve('/repo/specs'), 'a1b2c3d4')).toBe(true)
  },
)

test(
  [
    'given use-cases/handoff-location::isSharedHandoffDir',
    "when the resolved path carries this run's id",
    "it should say the directory is this run's own",
  ].join(', '),
  () => {
    expect(
      isSharedHandoffDir(resolve('/repo/specs/a1b2c3d4'), 'a1b2c3d4'),
    ).toBe(false)
  },
)
