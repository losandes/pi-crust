import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createTracer } from '../domains/trace'
import { activityRunParams, agentConfigSchema } from '../lib/contracts'
import type { TEnv } from '../lib/system'
import { configText } from './config-document'

export const tokenRepo = (
  options: Readonly<{
    relative?: boolean
    linked?: boolean
    overrideData?: boolean
    overrideDb?: boolean
    separateData?: boolean
  }> = {},
) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'crust-token-')))
  const configuredData = join(root, '.pi-crust', 'data')
  const dataDir = options.overrideData
    ? realpathSync(mkdtempSync(join(tmpdir(), 'crust-token-data-')))
    : options.separateData
      ? join(root, 'other-data')
      : configuredData
  const dbPath = options.overrideDb
    ? join(root, 'other-store', 'crust.db')
    : join(options.separateData ? configuredData : dataDir, 'crust.db')
  const runId = 'aaaa1111'
  const sessionDir = join(dataDir, 'sessions', runId)
  const configPath = join(root, 'fixture.pi-crust.toml')
  const prefix = options.relative ? '' : '{primary_worktree}/'
  mkdirSync(join(sessionDir, 'builder', 'pi_sessions'), { recursive: true })
  mkdirSync(join(sessionDir, 'context_handoff'), { recursive: true })
  writeFileSync(
    configPath,
    configText({
      defaults: {
        data_dir: options.separateData ? dataDir : `${prefix}.pi-crust/data`,
      },
    }),
  )
  writeFileSync(
    join(root, 'resumed.ts'),
    `await Bun.write(${JSON.stringify(join(root, 'resumed.json'))}, JSON.stringify(process.argv.slice(2)))\n`,
  )
  writeFileSync(
    join(sessionDir, 'invocation.json'),
    JSON.stringify({ argv: ['bun', join(root, 'resumed.ts')], cwd: root }),
  )
  writeFileSync(
    join(root, 'fake-pi'),
    '#!/usr/bin/env bun\nprocess.stdout.write("fixture agent answer\\n")\n',
  )
  chmodSync(join(root, 'fake-pi'), 0o755)
  const tracer = createTracer(dbPath, join(sessionDir, 'events.jsonl'))
  const activityRun = {
    activity_run_id: `${runId}_01_build`,
    run_id: runId,
    seq: 1,
    params: activityRunParams({
      name: 'build',
      kind: 'agent',
      owner: 'builder',
      description: 'Complete an activity for consultation',
    }),
    status: 'success' as const,
    error: undefined,
    started_at: undefined,
    ended_at: undefined,
  }
  tracer.sessionStart(runId, 'tester', 'sdlc')
  tracer.sessionRequest(runId, 'fixture request')
  tracer.activityRunUpsert(activityRun)
  tracer.agentSessionRow(
    runId,
    agentConfigSchema.parse({
      name: 'builder',
      model: 'test/model',
      prompts: '.',
      writes: [],
    }),
    'fixture-session',
    0,
    0,
  )
  tracer.sessionFinish(runId, false)
  tracer.close()
  const git = (...argv: readonly string[]) =>
    execFileSync('git', argv, { cwd: root, encoding: 'utf8' })
  const cwd = options.linked ? join(root, 'linked') : root
  if (options.linked) {
    git('init', '-q', '-b', 'main')
    git(
      '-c',
      'user.name=tester',
      '-c',
      'user.email=tester@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-qm',
      'fixture',
    )
    git('worktree', 'add', '-qb', 'linked', cwd)
  }
  const env: TEnv = {
    ...process.env,
    CRUST_CONFIG: configPath,
    CRUST_MACHINE_CONFIG: '/nonexistent/crust-machine-config',
    CRUST_DB: options.overrideDb || options.separateData ? dbPath : '',
    CRUST_DATA_DIR: options.overrideData ? dataDir : '',
    PI_PATH: join(root, 'fake-pi'),
  }
  return {
    root,
    dataDir,
    dbPath,
    runId,
    sessionDir,
    configPath,
    invoke: (entry: string, args: readonly string[]) =>
      Bun.spawnSync(
        ['bun', resolve(import.meta.dir, '..', 'commands', entry), ...args],
        {
          cwd,
          env,
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 15000,
        },
      ),
    [Symbol.dispose]: () => {
      rmSync(root, { recursive: true, force: true })
      if (options.overrideData) {
        rmSync(dataDir, { recursive: true, force: true })
      }
    },
  }
}
