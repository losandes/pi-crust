import { spawn } from 'node:child_process'
import { errorMessage, safeParseSettlement } from '../../../../../lib/typedefs'
import type { TShellResult, TShellSpec } from '../typedefs/task'
import { forwardTermination, signalGroup } from './forward-termination'

export const runShellCommand =
  (graceMs: number) =>
  ({
    command,
    cwd,
    timeoutSeconds,
    env,
  }: TShellSpec): Promise<TShellResult> => {
    const started = performance.now()
    const duration = () => (performance.now() - started) / 1000
    const spawned = safeParseSettlement(() =>
      spawn('sh', ['-c', command], {
        cwd,
        env: { ...env },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    )
    if (spawned.status === 'error') {
      return Promise.resolve({
        returncode: 127,
        timedOut: false,
        stdout: '',
        stderr: errorMessage(spawned.error),
        durationSeconds: duration(),
      })
    }
    const child = spawned.data
    return new Promise((deliver) => {
      const detach = forwardTermination(process)(child.pid)
      const signal = (name: NodeJS.Signals) =>
        signalGroup(process)(child.pid, name)
      // Streams, timer and child events share this state until one completes the command.
      let stdout = ''
      let stderr = ''
      let timedOut = false
      let delivered = false
      let spawnFailed = false
      let grace: ReturnType<typeof setTimeout> | undefined
      const finish = (code: number) => {
        if (delivered) return
        delivered = true
        clearTimeout(timeout)
        clearTimeout(grace)
        if (timedOut) {
          signal('SIGKILL')
          child.stdout.destroy()
          child.stderr.destroy()
        }
        detach()
        deliver({
          returncode: timedOut ? 124 : code,
          timedOut,
          stdout,
          stderr,
          durationSeconds: duration(),
        })
      }
      const timeout = setTimeout(() => {
        timedOut = true
        signal('SIGTERM')
        grace = setTimeout(() => finish(124), graceMs)
      }, timeoutSeconds * 1000)
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk
      })
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr += chunk
      })
      child.once('error', (error) => {
        spawnFailed = true
        stderr += error.message
      })
      child.once('close', (code) => finish(spawnFailed ? 127 : (code ?? 1)))
    })
  }
