import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TActivityRunStatus, TStage } from '../../../../lib/contracts'
import {
  activityRunParams,
  EXIT,
  pullRequestOutput,
} from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import type { TDeliveryPorts } from '../../../activities'
import { readRunState } from '../../../trace'
import { gateFixture, portsFor, review, work } from './human-gate-fixture.test'
import { CANCELLED_BY_FAILURE } from './run-terminal'
import { deliveryFixture } from './run-terminal-fixture.test'
import { runWorkflow } from './run-workflow'
import { NEVER_SETTLED } from './supersede-replaced-attempts'

const workflowFixture = (
  options: Readonly<{
    failsAgain?: boolean
    concurrent?: boolean
    interrupted?: boolean
  }> = {},
) => {
  const environment = gateFixture({ attempts: 1 })
  const repository = deliveryFixture()
  const { run, dir } = environment
  const runId = 'sup166aa'
  const sessionDir = join(dir, 'sessions', runId)
  const terminal = {
    name: 'gh-pull-request',
    model: 'fixture/delivery',
    purpose: 'Deliver accepted work',
    prompt_engineering: {
      system: join(dir, 'system.md'),
      user: join(dir, 'user.md'),
    },
    writes: [],
  }
  const entries = run.cfg.activities.map((agent) => ({
    ...agent,
    output: options.concurrent ? 'reviewOutput' : agent.output,
  }))
  const config = join(dir, 'workflow.config.yaml')
  writeFileSync(
    config,
    Bun.YAML.stringify({
      ...run.cfg,
      defaults: { ...run.cfg.defaults, data_dir: dir },
      agents: [...entries, terminal],
      activities: entries,
      terminal: [terminal],
    }),
  )
  const plan: readonly TStage[] = options.concurrent
    ? [
        {
          name: 'reviewers',
          strategy: 'concurrent',
          activities: ['review', 'verify'],
        },
      ]
    : [
        { name: 'work', strategy: 'serial', activities: ['build', 'review'] },
        {
          name: 'deliver',
          strategy: 'serial',
          activities: ['gh-pull-request'],
        },
      ]
  const { ports, requests } = portsFor((model, attempt) => {
    if (model === 'fixture/delivery')
      return pullRequestOutput.schema.parse({
        ...work(),
        title: 'Deliver work',
        body: 'Completed work',
      })
    const fails =
      !options.interrupted &&
      (options.concurrent || model === 'fixture/build') &&
      (attempt === 1 || options.failsAgain)
    if (options.concurrent || model === 'fixture/review')
      return review({
        status: fails ? 'fail' : 'success',
        approved: !fails,
        blocking: [],
        findings: [],
      })
    return work({
      status: fails ? 'fail' : 'success',
      summary: fails ? 'fixture failure' : 'built the work',
    })
  })
  let created = 0
  const delivery: TDeliveryPorts = {
    defaultBranch: () => '',
    isRepo: () => true,
    branch: () => 'topic',
    remoteExists: () => true,
    baseRef: () => 'main',
    commitsAhead: () => 1,
    push: () => undefined,
    uncommitted: () => [],
    forge: {
      authenticated: () => true,
      whoami: () => 'tester',
      find: () => '',
      create: () => {
        created += 1
        return 'https://github.com/example/repo/pull/166'
      },
      update: () => '',
    },
  }
  const execute = (resume = false) =>
    runWorkflow(
      {
        prompt: 'Implement issue #166',
        config,
        runId,
        resume,
        base: undefined,
        activities: undefined,
        lifecycle: undefined,
        models: undefined,
        approveAfter: undefined,
        commit: undefined,
        stream: false,
        trustLevel: undefined,
        handoff: undefined,
        name: undefined,
      },
      plan,
      ports,
      () => ({ provider: 'fixture', modelId: 'model' }),
      async () => false,
      delivery,
    )
  const seed = (statuses: readonly TActivityRunStatus[], cancelled = false) => {
    run.tracer.sessionStart(runId, 'tester', 'compose')
    statuses.forEach((status, index) => {
      run.tracer.activityRunUpsert({
        activity_run_id: `${runId}_${index + 1}_build`,
        run_id: runId,
        seq: index + 1,
        params: activityRunParams({
          name: 'build',
          kind: 'agent',
          owner: 'build',
          description: 'Implement the requested change',
        }),
        status,
        error: status === 'fail' ? 'original failure' : undefined,
        started_at: '2024-01-01T00:00:00.000Z',
        ended_at: status === 'running' ? undefined : '2024-01-01T00:00:01.000Z',
      })
    })
    if (statuses.includes('success')) {
      mkdirSync(join(sessionDir, 'build'), { recursive: true })
      writeFileSync(
        join(sessionDir, 'build', 'envelope.json'),
        JSON.stringify({
          ...work(),
          agent_name: 'build',
          purpose: 'Implement the requested change',
          output_type: 'BuildOutput',
        }),
      )
    }
    if (cancelled) {
      run.tracer.activityRunUpsert({
        activity_run_id: `${runId}_3_review`,
        run_id: runId,
        seq: 3,
        params: activityRunParams({
          name: 'review',
          kind: 'agent',
          owner: 'review',
          description: 'Judge the completed work',
        }),
        status: 'success',
        error: undefined,
        started_at: undefined,
        ended_at: undefined,
      })
      mkdirSync(join(sessionDir, 'review'), { recursive: true })
      writeFileSync(
        join(sessionDir, 'review', 'envelope.json'),
        JSON.stringify({
          ...review({ approved: true, blocking: [], findings: [] }),
          agent_name: 'review',
          purpose: 'Judge the completed work',
          output_type: 'ReviewOutput',
        }),
      )
      const id = `${runId}_4_gh-pull-request`
      run.tracer.activityRunUpsert({
        activity_run_id: id,
        run_id: runId,
        seq: 4,
        params: activityRunParams({
          name: 'gh-pull-request',
          kind: 'agent',
          owner: 'gh-pull-request',
          description: 'Deliver accepted work',
        }),
        status: 'cancelled',
        error: undefined,
        started_at: undefined,
        ended_at: undefined,
      })
      run.tracer.event({
        run_id: runId,
        activity_run_id: id,
        type: 'log',
        name: 'terminal_cancelled',
        payload: { activity: 'gh-pull-request', reason: CANCELLED_BY_FAILURE },
      })
    }
    if (!statuses.includes('running')) run.tracer.sessionFinish(runId, false)
  }
  return {
    run,
    runId,
    execute,
    seed,
    requests,
    created: () => created,
    rows: (name: string) =>
      run.tracer
        .activityRunsFor(runId)
        .filter((row) => row.params.name === name),
    state: () => readRunState(run.tracer.dbPath, runId)?.status,
    [Symbol.dispose]: () => {
      repository[Symbol.dispose]()
      environment[Symbol.dispose]()
    },
  }
}

for (const failsAgain of [false, true]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      'given a workflow whose first build reports failure',
      `when resumed and build ${failsAgain ? 'fails again' : 'succeeds'}`,
      'it should replace the earlier failure and deliver only after success',
    ].join(', '),
    async () => {
      // given
      using fixture = workflowFixture({ failsAgain })
      await expect(fixture.execute()).rejects.toThrow()

      // when
      const actual = fixture.execute(true)

      // then
      if (failsAgain) await expect(actual).rejects.toThrow()
      else expect(await actual).toBe(EXIT.SUCCESS)
      expect(fixture.rows('build').map((row) => row.status)).toEqual([
        'superseded',
        failsAgain ? 'fail' : 'success',
      ])
      expect(fixture.rows('build')[0]?.error).toBeDefined()
      expect(fixture.rows('gh-pull-request').map((row) => row.status)).toEqual(
        failsAgain ? [] : ['success'],
      )
      expect(fixture.created()).toBe(failsAgain ? 0 : 1)
      expect(fixture.state()).toBe(failsAgain ? 'fail' : 'success')
    },
  )
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given two concurrently failing reviewers',
    'when both succeed on resume',
    'it should supersede both failures and finish successfully',
  ].join(', '),
  async () => {
    // given
    using fixture = workflowFixture({ concurrent: true })
    await expect(fixture.execute()).rejects.toThrow()

    // when
    const actual = await fixture.execute(true)

    // then
    expect(actual).toBe(EXIT.SUCCESS)
    expect(fixture.rows('review').map((row) => row.status)).toEqual([
      'superseded',
      'success',
    ])
    expect(fixture.rows('verify').map((row) => row.status)).toEqual([
      'superseded',
      'success',
    ])
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a never-settled build with no live process',
    'when resumed build succeeds',
    'it should preserve the interruption as superseded and deliver successfully',
  ].join(', '),
  async () => {
    // given
    using fixture = workflowFixture({ interrupted: true })
    fixture.seed(['running'])

    // when
    const actual = await fixture.execute(true)

    // then
    expect(actual).toBe(EXIT.SUCCESS)
    expect(fixture.rows('build').map((row) => row.status)).toEqual([
      'superseded',
      'success',
    ])
    expect(fixture.rows('build')[0]?.error).toBe(NEVER_SETTLED)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a successful build following a failed one and failure-cancelled delivery',
    'when the stuck run resumes',
    'it should replay build and recover delivery without repeating completed work',
  ].join(', '),
  async () => {
    // given
    using fixture = workflowFixture()
    fixture.seed(['fail', 'success'], true)

    // when
    const actual = await fixture.execute(true)

    // then
    expect(actual).toBe(EXIT.SUCCESS)
    expect(fixture.requests().map((request) => request.model)).toEqual([
      'fixture/delivery',
    ])
    expect(fixture.rows('build').map((row) => row.status)).toEqual([
      'superseded',
      'success',
    ])
    expect(fixture.rows('gh-pull-request').map((row) => row.status)).toEqual([
      'superseded',
      'success',
    ])
    expect(fixture.created()).toBe(1)
  },
)
