import { expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { safeParseSettlement } from '../../../../../lib/typedefs'
import { operatorEnv } from '../../../../lib/system'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { renderTaskCommand } from '../use-cases/render-task-command'
import { runShellCommand } from './run-shell-command'

const execute =
  (cwd: string, timeoutSeconds = 1) =>
  (command: string) =>
    runShellCommand(300)({ cwd, timeoutSeconds, command, env: operatorEnv() })

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a shell script with a pipe, redirection and &&',
    'when executing it',
    'it should use the exit status of the shell and capture both streams',
  ].join(', '),
  async () => {
    // given
    const cwd = mkdtempSync(join(tmpdir(), 'crust-shell-'))
    try {
      // when
      const actual = await execute(cwd)(
        'false | cat && printf hello > output; cat output; printf err >&2; exit 3',
      )
      // then
      expect(readFileSync(join(cwd, 'output'), 'utf8')).toBe('hello')
      expect(actual).toMatchObject({
        stdout: 'hello',
        stderr: 'err',
        returncode: 3,
        timedOut: false,
      })
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a shell that cannot start',
    'when the working directory is missing',
    'it should return an error message and exit 127',
  ].join(', '),
  async () => {
    // given
    const cwd = mkdtempSync(join(tmpdir(), 'crust-missing-shell-cwd-'))
    rmSync(cwd, { recursive: true })
    // when
    const actual = await execute(cwd)('true')
    // then
    expect(actual).toMatchObject({ returncode: 127, timedOut: false })
    expect(actual.stderr).not.toBe('')
  },
)

for (const command of [
  'sleep 30 & echo $! > child.pid; wait',
  `sh -c 'trap "" TERM; exec sleep 30' >/dev/null 2>&1 & echo $! > child.pid; wait`,
]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given a background process whose shell closes at timeout (${command})`,
      'when the timeout elapses',
      'it should terminate the group and deliver the result before the grace period expires',
    ].join(', '),
    async () => {
      // given
      const cwd = mkdtempSync(join(tmpdir(), 'crust-task-background-'))
      const pidPath = join(cwd, 'child.pid')
      try {
        // when
        const actual = await runShellCommand(2000)({
          command,
          cwd,
          timeoutSeconds: 1,
          env: operatorEnv(),
        })
        // then
        expect(actual).toMatchObject({ returncode: 124, timedOut: true })
        expect(actual.durationSeconds).toBeLessThan(3)
        const pid = Number(readFileSync(pidPath, 'utf8'))
        // Delivery follows SIGKILL, not kernel reaping of the orphaned child.
        const deadline = performance.now() + 500
        while (
          performance.now() < deadline &&
          safeParseSettlement(() => process.kill(pid, 0)).status === 'ok'
        ) {
          await Bun.sleep(10)
        }
        expect(() => process.kill(pid, 0)).toThrow()
      } finally {
        stopFixtureChild(pidPath)
        rmSync(cwd, { recursive: true, force: true })
      }
    },
  )
}

const stopFixtureChild = (pidPath: string) => {
  if (!existsSync(pidPath)) return
  const pid = Number(readFileSync(pidPath, 'utf8'))
  if (!Number.isInteger(pid) || pid <= 0) return
  const stopped = safeParseSettlement(() => process.kill(pid, 'SIGKILL'))
  if (
    stopped.status === 'error' &&
    (!('code' in stopped.error) || stopped.error.code !== 'ESRCH')
  )
    throw stopped.error
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a detached process outside the shell group keeping stdout open',
    'when the grace period expires',
    'it should deliver the timed-out result without waiting for that process',
  ].join(', '),
  async () => {
    // given
    const cwd = mkdtempSync(join(tmpdir(), 'crust-task-detached-'))
    const pidPath = join(cwd, 'child.pid')
    try {
      writeFileSync(
        join(cwd, 'detach.ts'),
        `
      import { spawn } from 'node:child_process'
      import { writeFileSync } from 'node:fs'
      const child = spawn('sleep', ['30'], { detached: true, stdio: ['ignore', 'inherit', 'ignore'] })
      writeFileSync('child.pid', String(child.pid))
      child.unref()
    `,
      )
      const command = renderTaskCommand(
        [process.execPath, 'detach.ts'],
        '',
      )('exec {{changed_paths}}')
      // when
      // Allow the Bun helper to start and publish its PID under parallel load.
      const actual = await execute(cwd, 5)(command)
      // then
      expect(actual).toMatchObject({ returncode: 124, timedOut: true })
      expect(actual.durationSeconds).toBeLessThan(7)
      expect(() =>
        process.kill(Number(readFileSync(pidPath, 'utf8')), 0),
      ).not.toThrow()
    } finally {
      stopFixtureChild(pidPath)
      rmSync(cwd, { recursive: true, force: true })
    }
  },
  10_000,
)

for (const command of ["printf starting; trap '' TERM; sleep 30"]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given a long-running command: ${command}`,
      'when the timeout elapses',
      'it should deliver captured output and exit 124 within the grace window',
    ].join(', '),
    async () => {
      // given
      const run = execute(process.cwd())
      // when
      const actual = await run(command)
      // then
      expect(actual).toMatchObject({
        returncode: 124,
        timedOut: true,
        stdout: 'starting',
      })
      expect(actual.durationSeconds).toBeLessThan(3)
    },
  )
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a shell that receives a signal before timeout',
    'when collecting the result',
    'it should fail without marking it as a timeout',
  ].join(', '),
  async () => {
    // given
    const run = execute(process.cwd())
    // when
    const actual = await run('kill -TERM $$')
    // then
    expect(actual).toMatchObject({ returncode: 1, timedOut: false })
  },
)
