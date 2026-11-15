/** A fresh process at the real resume boundary; all delivery I/O is injected. */
import { finish, finishWaiting } from './run-activity-run'
import { runTerminal } from './run-terminal'
import {
  deliveryConfig,
  terminalActivity,
  terminalContext,
} from './run-terminal-fixture.test'
import { startSession } from './start-session'

if (import.meta.main && process.argv.includes('--resume-delivery-fixture')) {
  const run = startSession(deliveryConfig(process.cwd()), 'eecc125a', {
    resume: true,
  })
  const outcome = await runTerminal({
    run,
    activity: terminalActivity(() =>
      Promise.resolve({
        action: 'created',
        url: 'https://example.test/pull/125',
        reason: '',
        recoverable: false,
        fallback: false,
      }),
    ),
    ctx: terminalContext(run),
    accepted: true,
  })
  process.exitCode =
    outcome.kind === 'waiting'
      ? finishWaiting(run, outcome.request)
      : finish(run)
  run.tracer.close()
}
