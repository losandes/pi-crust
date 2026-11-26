import { resolve } from 'node:path'
import {
  resolveRunDirectory,
  sessionsDirIn,
} from '../../../../../lib/run-directories'
import type { TEnv } from '../../../../lib/system'
import { configPathFromEnv } from '../../../../lib/system'
import { loadConfig } from '../../../config'
import {
  consultArgv,
  consultEvent,
  handoffDirFor,
  runConsult,
  sessionDirFor,
  type TConsultMode,
  type TConsultRequest,
} from '../../../handoff'
import { createTracer, resolveConsultTarget } from '../../../trace'
import { repoRoot, resolveLookupPaths } from '../../../workspace'

export const USAGE =
  'usage: crust <ask|amend> <run-id> <activity> "question"\n' +
  'env: CRUST_DB and CRUST_CONFIG override the paths; the flags still win.'

export const consultActivity =
  (ports: TConsultPorts) =>
  async (mode: TConsultMode, argvInput: readonly string[]): Promise<number> => {
    const say = ports.say
    const [runId, activity, ...rest] = argvInput
    const question = rest.join(' ').trim()
    if (
      (mode !== 'ask' && mode !== 'amend') ||
      runId === undefined ||
      activity === undefined ||
      question === ''
    ) {
      say(USAGE)
      return 2
    }

    const configPath = configPathFromEnv(ports.env)
    const cfg = loadConfig(configPath)
    const { db: dbPath, dataDir } = resolveLookupPaths(
      cfg,
      repoRoot(),
      ports.env,
    )

    const resolved = resolveConsultTarget(dbPath)(runId, activity)
    if (resolved.status === 'error') {
      say(resolved.error.message)
      return 1
    }
    const target = resolved.data
    const runDir = resolveRunDirectory({
      dbPath,
      sessionsDir: sessionsDirIn(dataDir),
    })(runId)
    const handoffDir = handoffDirFor(runDir)
    const request: TConsultRequest = {
      runId,
      activityRunId: target.activityRunId,
      agent: target.agent,
      sessionId: target.sessionId,
      sessionDir: sessionDirFor(runDir, target.agent),
      handoffDir,
      mode: mode as TConsultMode,
      // What the person asked, verbatim. The preamble that tells the agent
      // which mode this is rides in the argv, so the record stays the
      // question rather than the question plus machinery.
      question,
      own: target.own,
    }

    const [provider = 'anthropic', modelId = target.model] = (
      target.model ?? ''
    ).split('/')
    const argv = consultArgv(
      request,
      { provider, modelId },
      ports.env.PI_PATH ?? 'pi',
    )

    say(`${mode} → ${target.agent} (${activity}) in run ${runId}`)
    const outcome = await runConsult(
      request,
      (line) => ports.invoke(line, ports.cwd),
      argv,
    )

    if (!outcome.answered) {
      say(outcome.reason)
      return 1
    }

    // Recorded against the activityRun it asked about, so the thread is found where
    // the question made sense rather than at the end of the run.
    const tracer = createTracer(dbPath, resolve(runDir, 'events.jsonl'))
    const event = consultEvent(request, outcome)
    tracer.event({
      run_id: runId,
      activity_run_id: target.activityRunId,
      type: 'consult',
      name: event.name,
      payload: event.payload,
    })
    tracer.close()

    say('')
    say(outcome.answer)
    if (outcome.amended.length > 0) {
      say('')
      say(`amended: ${outcome.amended.join(', ')}`)
      say(
        'activities after this one already ran against the previous version — the ' +
          'trace marks them, acting on it is your call.',
      )
    }
    if (outcome.restored.length > 0) {
      say(
        `restored (belonged to another activity): ${outcome.restored.join(', ')}`,
      )
    }
    return 0
  }

export type TConsultPorts = Readonly<{
  env: TEnv
  cwd: string
  invoke: (
    argv: readonly string[],
    cwd: string,
  ) => Promise<Readonly<{ ok: boolean; output: string }>>
  say: (line: string) => void
}>
