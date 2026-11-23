import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
  TActivityContext,
  TEnvelopeBase,
  TRun,
} from '../../../../lib/contracts'
import {
  buildOutputSchema,
  crustConfigSchema,
  reviewOutputSchema,
} from '../../../../lib/contracts'
import { configText } from '../../../../testing/config-document'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import type { TAgentPorts } from '../../../activities'
import type { TPiRequest } from '../../../agents'
import { emptyUsage } from '../../../agents'
import { createTracer } from '../../../trace'
import { createRun } from './create-run'
import { startSession } from './start-session'

export const QUESTION = {
  question: 'Which retention window is authorised?',
  consequential: true,
  beyond_this_run: false,
  provisional_answer: '',
}

const CONTEXT = {
  status: 'success',
  summary: 'Finished the work',
  artifacts: [],
  notes_for_next_agent: '',
  facts: [],
  decisions: [],
  assumptions: [],
  unresolved: [],
  risks: [],
  objective_met: { met: true, evidence: 'fixture verification' },
  regress_to: { activity: '', because: '' },
}

export const work = (overrides: Readonly<Record<string, unknown>> = {}) =>
  buildOutputSchema.parse({ ...CONTEXT, changed_files: [], ...overrides })

export const review = (overrides: Readonly<Record<string, unknown>> = {}) =>
  reviewOutputSchema.parse({
    ...CONTEXT,
    approved: false,
    blocking: ['Use the authorised retention window'],
    findings: [
      {
        requirement: 'Use the authorised retention window',
        met: false,
        evidence: 'src/retention.ts:12',
      },
    ],
    ...overrides,
  })

export const contextFor = (run: TRun): TActivityContext => ({
  run,
  prompt: 'Implement the retention policy',
  previous: undefined,
  previousStep: undefined,
  upstream: [],
  cohort: [],
  baseline: '',
  outcomes: [],
  feedback: [],
})

export const gateFixture = (
  options: Readonly<{ trust?: number; attempts?: number }> = {},
) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'crust-human-gate-')))
  const environment = {
    CRUST_DATA_DIR: '',
    CRUST_DB: join(dir, 'crust.db'),
    CRUST_MACHINE_CONFIG: join(dir, 'absent-machine-config'),
    CRUST_REGISTRY: join(dir, 'workspaces.jsonl'),
  }
  const original = Object.keys(environment).map((key) => ({
    key,
    value: process.env[key],
  }))
  // biome-ignore lint/plugin/no-object-mutation: process.env is the external configuration API; this fixture isolates it and restores it on disposal
  Object.assign(process.env, environment)
  silenceTerminal()
  const system = join(dir, 'system.md')
  const user = join(dir, 'user.md')
  writeFileSync(system, '# Fixture system\n')
  writeFileSync(user, '# Fixture user\n')
  const entries = ['build', 'review', 'verify'].map((name) => ({
    name,
    model: `fixture/${name}`,
    purpose: `Perform the ${name} work`,
    output: name === 'review' ? 'reviewOutput' : 'buildOutput',
    attempts: options.attempts ?? 4,
    prompts: dirname(system),
    writes: [],
  }))
  const cfg = crustConfigSchema.parse({
    defaults: { data_dir: join(dir, 'data'), protected_files: [] },
    observability: { db: environment.CRUST_DB },
    agents: entries,
    activities: entries,
  })
  const tracer = createTracer(cfg.observability.db, join(dir, 'events.jsonl'))
  const run = createRun({
    cfg,
    runId: 'wait0117',
    tracer,
    engineer: 'tester',
    trust: options.trust ?? 50,
  })
  tracer.sessionStart(run.runId, run.engineer, 'compose')
  let tracers = [tracer]
  const signalListeners = {
    SIGINT: process.listeners('SIGINT'),
    SIGTERM: process.listeners('SIGTERM'),
  }

  return {
    dir,
    run,
    resume: () => {
      const resumed = startSession(cfg, run.runId, {
        resume: true,
        trust: run.trust,
      })
      tracers = [...tracers, resumed.tracer]
      return resumed
    },
    configPath: () => {
      const path = join(dir, 'pi-crust.toml')
      writeFileSync(path, configText(cfg))
      return path
    },
    [Symbol.dispose]: () => {
      for (const one of tracers) one.close()
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        for (const listener of process.listeners(signal)) {
          if (!signalListeners[signal].includes(listener)) {
            process.removeListener(signal, listener)
          }
        }
      }
      for (const { key, value } of original) {
        if (value === undefined) delete process.env[key]
        // biome-ignore lint/plugin/no-array-mutation: process.env is the external configuration API; restore the caller's original value
        else process.env[key] = value
      }
      restoreTerminal()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

export const portsFor = (
  answer: (model: string, attempt: number) => TEnvelopeBase,
) => {
  let requests: readonly TPiRequest[] = []
  let renders: readonly Readonly<Record<string, string>>[] = []
  const ports: TAgentPorts = {
    run: (request) => {
      const attempt =
        requests.filter((one) => one.model === request.model).length + 1
      requests = [...requests, request]
      return Promise.resolve({
        text: JSON.stringify(answer(request.model, attempt)),
        returncode: 0,
        sessionId: 'fixture-session',
        tokens: 0,
        cost: 0,
        usage: emptyUsage,
        contextTokens: 0,
        contextWindow: 0,
      })
    },
    changed: () => [],
    untracked: () => [],
    render: (_path, variables) => {
      renders = [...renders, variables]
      return JSON.stringify(variables)
    },
    savePrompt: (directory, name) => join(directory, name),
    snapshot: () => ({}),
    rev: () => '',
    head: () => '',
    history: () => () => [],
    content: () => ({ status: 'ok', data: {} }),
  }
  return { ports, requests: () => requests, renders: () => renders }
}
