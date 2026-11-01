/**
 * Console reporter: one narrative, two destinations.
 *
 * Every line a workflow prints ALSO lands in the db as a `log` event, so the
 * swim-lane UI reads the same story the terminal does. Both go through `emit` —
 * print and trace cannot drift. Plain sequential lines only: no spinners, no
 * live displays, so a CI log reads exactly like a terminal.
 */

import {
  box,
  clip,
  KIND_COLOR,
  paint,
  plain,
  writeLine,
} from '../data/terminal'
import type { TEnvelopeBase } from '../typedefs/envelope'
import type { TGateReport } from '../typedefs/gate'
import { reportPassed, violationsOf } from '../typedefs/gate'
import type { TActivityRun } from '../typedefs/activity-run'
import type { TConsole } from '../typedefs/run'
import type { TTracer } from '../typedefs/trace'
import { counts } from './run-activity-run'
import {
  renderWarnings,
  WARNING_EVENT,
  warningFromPayload,
} from '../typedefs/warning'

const thousands = (value: number): string => value.toLocaleString('en-US')

/** How much of a prompt the TERMINAL shows. The traced copy is never cut. */
export const PROMPT_BODY_LINES = 40
export const PROMPT_BODY_CHARS = 2000

const promptBody = (prompt: string): string =>
  prompt.split('\n').slice(0, PROMPT_BODY_LINES).join('\n').slice(0, PROMPT_BODY_CHARS)

/**
 * Bound to one run's tracer. Reachable as `run.console` everywhere.
 *
 * `write` defaults to the real `writeLine` — the function every production
 * CLI entry point uses to print. A test supplies a silent (or recording)
 * `write` instead, so exercising `createConsole`'s methods never touches the
 * real `process.stdout` as a side effect of asserting on the traced copy.
 */
export const createConsole = (
  tracer: TTracer,
  runId: string,
  write: (text: string) => void = writeLine,
): TConsole => {
  let activityRunId = '' // current lane — log events attach to it
  let activityRunName = ''
  let finished = false // the summary panel prints once

  // ── the one helper: print AND trace, always together ──────────────────────
  const emit = (line: string, level = 'info', renderable?: string): void => {
    write(renderable ?? line)
    tracer.event({
      run_id: runId,
      activity_run_id: activityRunId,
      type: 'log',
      name: activityRunName || 'console',
      payload: { message: plain(line), level },
    })
  }

  return {
    sessionStarted: (startedAdwId, engineer, workspaceRoot, vcsRoot) => {
      emit(
        `${paint('run_id:', 'bold', 'cyan')} ${paint(startedAdwId, 'bold')}` +
          `   ${paint('engineer', 'dim')} ${engineer}`,
      )
      // Neither root is an error (1.5.3) -- said once, plainly, only when a
      // nested workspace makes them differ, so a flat repository's banner
      // is unchanged from before this line existed.
      if (vcsRoot !== '' && vcsRoot !== workspaceRoot) {
        emit(
          `${paint('workspace', 'dim')} ${workspaceRoot}   ` +
            `${paint('vcs root', 'dim')} ${vcsRoot}`,
        )
      }
    },

    promptReceived: (prompt) => {
      const lineCount = prompt === '' ? 0 : prompt.split('\n').length
      const shown = promptBody(prompt)
      const header =
        `${paint('prompt:', 'bold', 'cyan')} ` +
        paint(
          `${prompt.length} chars · ${lineCount} line${lineCount === 1 ? '' : 's'}`,
          'dim',
        )
      const body =
        shown === ''
          ? []
          : shown.split('\n').map((line) => `${paint('│', 'dim')} ${line}`)
      const elided =
        shown.length === prompt.length
          ? []
          : [
              paint(
                `│ … ${prompt.length - shown.length} more characters — ` +
                  'the whole prompt is in the trace',
                'dim',
              ),
            ]
      emit(
        `prompt received (${prompt.length} chars): ${prompt}`,
        'info',
        [header, ...body, ...elided].join('\n'),
      )
    },

    sessionFinished: (ok, tokens, cost, dbPath) => {
      if (finished) {
        return
      }
      finished = true
      /*
       * Everything this run could not attribute, said once at the end.
       *
       * Read back from the trace rather than accumulated here: a warning
       * raised by the second of nine Activities is still owed to the reader
       * when the ninth finishes, and a line in the middle of a long run is a
       * line nobody scrolls back to.
       *
       * Before the summary panel, not after, because the panel is the last
       * word on the run and a warning under it reads as a footnote.
       */
      for (const line of renderWarnings(
        tracer
          .eventsNamed(runId, WARNING_EVENT)
          .flatMap((payload) => {
            const warning = warningFromPayload(payload)

            return warning === undefined ? [] : [warning]
          }),
      )) {
        emit(line, 'warn', line === '' ? '' : paint(line, 'yellow'))
      }
      /*
       * Read from the trace rather than an in-memory tally: this is what
       * makes the count agree with the verdict `finish` computed, including
       * the superseded rows the same predicate excludes (1.4.1, 1.4.2 of
       * specs/todos/FIX-SUPERSEDED-RUN-VERDICT.md).
       */
      const judged = tracer.activityRunsFor(runId).filter(counts)
      const passed = judged.filter((activityRun) => activityRun.status === 'success').length
      const status = ok ? paint('✓ success', 'green') : paint('✗ fail', 'red')
      const rows = [
        `${paint('status', 'dim')}   ${status}`,
        `${paint('activity runs', 'dim')}   ${passed}/${judged.length} passed`,
        `${paint('tokens', 'dim')}   ${thousands(tokens)}`,
        `${paint('cost', 'dim')}     $${cost.toFixed(4)}`,
        `${paint('run_id', 'dim')}   ${runId}`,
        `${paint('db', 'dim')}       ${dbPath}`,
        `${paint('next', 'dim')}     ${paint(`just crust activityRuns ${runId}`, 'bold')}`,
      ]
      const plainLine =
        `session ${runId} ${ok ? 'success' : 'fail'} · ` +
        `${passed}/${judged.length} activityRuns · ${thousands(tokens)} tokens · ` +
        `$${cost.toFixed(4)}`
      emit(
        plainLine,
        ok ? 'info' : 'error',
        box(paint('pi-crust run complete', 'bold'), rows, ok ? 'green' : 'red'),
      )
    },

    activityRunStarted: (activityRun: TActivityRun) => {
      activityRunId = activityRun.activity_run_id
      activityRunName = activityRun.params.name
      const p = activityRun.params
      const color = KIND_COLOR[p.kind] ?? 'bold'
      const seq = String(activityRun.seq).padStart(2, '0')
      emit(
        `${paint(`▶ ${seq} ${p.name}`, 'bold', color)}` +
          `  ${paint(p.kind, color)} ${paint(`· ${p.owner}`, 'dim')}` +
          (p.description ? `  ${paint(clip(p.description), 'dim')}` : ''),
      )
    },

    activityRunEnded: (activityRun: TActivityRun, seconds) => {
      const ok = activityRun.status === 'success'
      const mark = ok ? paint('✓', 'green') : paint('✗', 'red')
      emit(
        `  ${mark} ${activityRun.params.name} ${paint(`${seconds.toFixed(1)}s`, 'dim')}` +
          (ok || !activityRun.error ? '' : `  ${paint(clip(activityRun.error), 'red')}`),
        ok ? 'info' : 'error',
      )
      activityRunId = ''
      activityRunName = ''
    },

    /** Free-form detail inside the current activityRun — what `ph.log()` recorded. */
    note: (message) => {
      emit(`  ${paint(`· ${clip(message)}`, 'dim')}`)
    },

    instructions: (lines) => {
      for (const line of lines) {
        // Verbatim: no clip, no trim. A command with its tail cut off is worse
        // than no command, because it looks copyable.
        emit(line === '' ? '' : `  ${line}`)
      }
    },

    agentStarted: (name, model, sessionId) => {
      emit(
        `  ${paint('▸', 'magenta')} ${name} ${paint(model, 'dim')}` +
          `  ${paint(`session ${sessionId}`, 'dim')}`,
      )
    },

    agentFinished: (name, tokens, cost) => {
      emit(
        paint(
          `  └ ${name} used ${thousands(tokens)} tokens · $${cost.toFixed(4)}`,
          'dim',
        ),
      )
    },

    retry: (name, attempt, limit, reason) => {
      emit(
        `  ${paint('⟳', 'yellow')} ${name} retry ${attempt}/${limit} ` +
          paint(`— same session · ${clip(reason)}`, 'dim'),
        'warn',
      )
    },

    /** A gate reports WHAT it checked, not just whether it passed. */
    gateResult: (name, report) => {
      const typed = report as TGateReport
      const ok = reportPassed(typed)
      const violations = violationsOf(typed)
      const mark = ok ? paint('✓', 'green') : paint('✗', 'red')
      const summary = ok
        ? paint(`${typed.checks.length} checked`, 'dim')
        : paint(`${violations.length} of ${typed.checks.length} failed`, 'red')
      emit(
        `  ${mark} gate ${paint(name, 'dim')} ${summary}`,
        ok ? 'info' : 'error',
      )
      for (const check of typed.checks) {
        const detail = check.note ? ` — ${clip(check.note)}` : ''
        const line = `    ${check.ok ? '·' : '✗'} ${clip(check.item)}${detail}`
        emit(
          check.ok ? paint(line, 'dim') : paint(line, 'dim', 'red'),
          check.ok ? 'info' : 'error',
        )
      }
    },

    /**
     * The agent's own voice, under `--stream`.
     *
     * Wrapped and indented under a labelled header rather than printed raw: a
     * terminal that interleaves a model's prose with the factory's status
     * lines at the same indentation is unreadable, and the reader loses the
     * line that mattered.
     */
    narrate: (agent, channel, text) => {
      const header = channel === 'thinking' ? `${agent} thinking` : agent
      emit(paint(`  ${channel === 'thinking' ? '~' : '>'} ${header}`, 'dim'))
      for (const line of text.split('\n')) {
        emit(paint(`    ${line}`, channel === 'thinking' ? 'dim' : 'reset'))
      }
    },

    envelopeSummary: (typeName, envelope: TEnvelopeBase) => {
      const ok = envelope.status === 'success'
      emit(
        `  ${ok ? paint('✓', 'green') : paint('✗', 'red')} ` +
          `${typeName} ${paint(clip(envelope.summary), 'dim')}`,
        ok ? 'info' : 'error',
      )
      if (envelope.artifacts.length > 0) {
        emit(
          paint(`    artifacts: ${clip(envelope.artifacts.join(', '))}`, 'dim'),
        )
      }
    },
  }
}
