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

const thousands = (value: number): string => value.toLocaleString('en-US')

/** Bound to one run's tracer. Reachable as `run.console` everywhere. */
export const createConsole = (tracer: TTracer, runId: string): TConsole => {
  let activityRunId = '' // current lane — log events attach to it
  let activityRunName = ''
  let results: readonly string[] = [] // activityRun statuses, for the summary
  let finished = false // the summary panel prints once

  // ── the one helper: print AND trace, always together ──────────────────────
  const emit = (line: string, level = 'info', renderable?: string): void => {
    writeLine(renderable ?? line)
    tracer.event({
      run_id: runId,
      activity_run_id: activityRunId,
      type: 'log',
      name: activityRunName || 'console',
      payload: { message: plain(line), level },
    })
  }

  return {
    sessionStarted: (startedAdwId, engineer) => {
      emit(
        `${paint('run_id:', 'bold', 'cyan')} ${paint(startedAdwId, 'bold')}` +
          `   ${paint('engineer', 'dim')} ${engineer}`,
      )
    },

    sessionFinished: (ok, tokens, cost, dbPath) => {
      if (finished) {
        return
      }
      finished = true
      const passed = results.filter((status) => status === 'success').length
      const status = ok ? paint('✓ success', 'green') : paint('✗ fail', 'red')
      const rows = [
        `${paint('status', 'dim')}   ${status}`,
        `${paint('activity runs', 'dim')}   ${passed}/${results.length} passed`,
        `${paint('tokens', 'dim')}   ${thousands(tokens)}`,
        `${paint('cost', 'dim')}     $${cost.toFixed(4)}`,
        `${paint('run_id', 'dim')}   ${runId}`,
        `${paint('db', 'dim')}       ${dbPath}`,
        `${paint('next', 'dim')}     ${paint(`just crust activityRuns ${runId}`, 'bold')}`,
      ]
      const plainLine =
        `session ${runId} ${ok ? 'success' : 'fail'} · ` +
        `${passed}/${results.length} activityRuns · ${thousands(tokens)} tokens · ` +
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
      results = [...results, activityRun.status]
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
