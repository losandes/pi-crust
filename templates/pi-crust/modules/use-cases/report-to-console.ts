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
import type { TPhase } from '../typedefs/phase'
import type { TConsole } from '../typedefs/run'
import type { TTracer } from '../typedefs/trace'

const thousands = (value: number): string => value.toLocaleString('en-US')

/** Bound to one run's tracer. Reachable as `run.console` everywhere. */
export const createConsole = (tracer: TTracer, runId: string): TConsole => {
  let phaseId = '' // current lane — log events attach to it
  let phaseName = ''
  let results: readonly string[] = [] // phase statuses, for the summary
  let finished = false // the summary panel prints once

  // ── the one helper: print AND trace, always together ──────────────────────
  const emit = (line: string, level = 'info', renderable?: string): void => {
    writeLine(renderable ?? line)
    tracer.event({
      run_id: runId,
      phase_id: phaseId,
      type: 'log',
      name: phaseName || 'console',
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
        `${paint('phases', 'dim')}   ${passed}/${results.length} passed`,
        `${paint('tokens', 'dim')}   ${thousands(tokens)}`,
        `${paint('cost', 'dim')}     $${cost.toFixed(4)}`,
        `${paint('run_id', 'dim')}   ${runId}`,
        `${paint('db', 'dim')}       ${dbPath}`,
        `${paint('next', 'dim')}     ${paint(`just crust phases ${runId}`, 'bold')}`,
      ]
      const plainLine =
        `session ${runId} ${ok ? 'success' : 'fail'} · ` +
        `${passed}/${results.length} phases · ${thousands(tokens)} tokens · ` +
        `$${cost.toFixed(4)}`
      emit(
        plainLine,
        ok ? 'info' : 'error',
        box(paint('pi-crust run complete', 'bold'), rows, ok ? 'green' : 'red'),
      )
    },

    phaseStarted: (phase: TPhase) => {
      phaseId = phase.phase_id
      phaseName = phase.params.name
      const p = phase.params
      const color = KIND_COLOR[p.kind] ?? 'bold'
      const seq = String(phase.seq).padStart(2, '0')
      emit(
        `${paint(`▶ ${seq} ${p.name}`, 'bold', color)}` +
          `  ${paint(p.kind, color)} ${paint(`· ${p.owner}`, 'dim')}` +
          (p.description ? `  ${paint(clip(p.description), 'dim')}` : ''),
      )
    },

    phaseEnded: (phase: TPhase, seconds) => {
      const ok = phase.status === 'success'
      results = [...results, phase.status]
      const mark = ok ? paint('✓', 'green') : paint('✗', 'red')
      emit(
        `  ${mark} ${phase.params.name} ${paint(`${seconds.toFixed(1)}s`, 'dim')}` +
          (ok || !phase.error ? '' : `  ${paint(clip(phase.error), 'red')}`),
        ok ? 'info' : 'error',
      )
      phaseId = ''
      phaseName = ''
    },

    /** Free-form detail inside the current phase — what `ph.log()` recorded. */
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
