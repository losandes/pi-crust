import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { safeParseSettlement } from '../../../../../lib/typedefs'
import type { TEnvelopeBase } from '../../../../lib/contracts'
import {
  buildOutputSchema,
  EXIT,
  genericOutput,
  planOutputSchema,
  reviewOutputSchema,
} from '../../../../lib/contracts'
import {
  restoreTerminal,
  silenceTerminal,
  terminalOutput,
} from '../../../../testing/terminal-capture'
import type { TAgentPorts } from '../../../activities'
import { emptyUsage } from '../../../agents'
import { runWorkflow } from './run-workflow'

const CONTEXT = {
  status: 'success' as const,
  facts: [],
  decisions: [],
  assumptions: [],
  unresolved: [],
  risks: [],
  objective_met: { met: true, evidence: 'fixture' },
  regress_to: { activity: '', because: '' },
}

const CHAINS = [
  {
    writer: 'plan',
    output: 'planOutput',
    document: 'plan.md',
    firstReviewer: 'plan-comprehension',
    firstReview: 'plan_comprehension.md',
    secondReviewer: 'plan-readiness',
    secondReview: 'plan_readiness.md',
    round: 'revise-plan',
    stages: [
      {
        name: 'draft-plan',
        strategy: 'serial',
        activities: ['identify', 'plan'],
      },
      {
        name: 'review-plan',
        strategy: 'serial',
        activities: ['plan-comprehension', 'plan-readiness'],
      },
    ],
  },
  {
    writer: 'build',
    output: 'buildOutput',
    document: 'build_notes.md',
    firstReviewer: 'code-review',
    firstReview: 'code_review.md',
    secondReviewer: 'outcome-review',
    secondReview: 'outcome_review.md',
    round: 'revise',
    stages: [
      { name: 'identify', strategy: 'serial', activities: ['identify'] },
      { name: 'build', strategy: 'serial', activities: ['build'] },
      {
        name: 'review-build',
        strategy: 'serial',
        activities: ['code-review', 'outcome-review'],
      },
    ],
  },
] as const

type TChain = (typeof CHAINS)[number]
type TOperation = 'ordinary' | 'overwrite' | 'delete'
type TAction = Readonly<{
  activity: string
  document: string
  operation: TOperation
}>
type TWrite = Readonly<{
  activity: string
  attempt: number
  document: string
  outcome: string | undefined
}>
type TCall = Readonly<{
  activity: string
  attempt: number
  saw: Readonly<Record<string, string>>
}>

const eventsNamed = (dbPath: string, name: string, type: string) => {
  const db = new Database(dbPath, { readonly: true })
  const rows = db
    .query<unknown, [string, string]>(`
      SELECT
        e.activity_run_id,
        e.payload_json
      FROM events AS e
      WHERE e.name = ?
        AND e.type = ?
      ORDER BY e.rowid
    `)
    .all(name, type)
  db.close()
  return rows.map((row) => {
    const parsed = z
      .object({ activity_run_id: z.string(), payload_json: z.string() })
      .parse(row)
    return {
      activity_run_id: parsed.activity_run_id,
      payload: z
        .record(z.string(), z.unknown())
        .parse(JSON.parse(parsed.payload_json)),
    }
  })
}

const fixtureWith = (chain: TChain, rejections: number, action?: TAction) => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-workflow-revise-ownership-'))
  const data = join(dir, 'data')
  const handoff = join(data, 'sessions', 'abcd1234', 'context_handoff')
  const dbPath = join(data, 'crust.db')
  const keys = [
    'CRUST_MACHINE_CONFIG',
    'CRUST_DATA_DIR',
    'CRUST_REGISTRY',
  ] as const
  const before = keys.map((key) => [key, process.env[key]] as const)
  // biome-ignore lint/plugin/no-object-mutation: this fixture owns the environment boundary loadConfigWithNotes reads
  process.env.CRUST_MACHINE_CONFIG = join(dir, 'absent.yaml')
  // biome-ignore lint/plugin/no-object-mutation: this fixture owns the environment boundary resolveDataPaths reads
  process.env.CRUST_DATA_DIR = data
  // biome-ignore lint/plugin/no-object-mutation: this fixture owns the environment boundary registerWorkspace reads
  process.env.CRUST_REGISTRY = join(dir, 'workspaces.jsonl')
  const system = join(dir, 'system.md')
  const user = join(dir, 'user.md')
  writeFileSync(system, '# System\n')
  writeFileSync(user, '# User\n')
  const activities = [
    { name: 'identify', output: 'genericOutput' },
    { name: chain.writer, output: chain.output },
    { name: chain.firstReviewer, output: 'reviewOutput' },
    { name: chain.secondReviewer, output: 'reviewOutput' },
  ].map((entry) => ({
    ...entry,
    model: `fixture/${entry.name}`,
    purpose: `Exercise ${entry.name} against the preceding work`,
    attempts: 3,
    writes: [],
    prompts: { system, user },
  }))
  const config = join(dir, 'crust.config.yaml')
  writeFileSync(
    config,
    JSON.stringify({
      defaults: { data_dir: data },
      observability: { db: dbPath },
      activities,
      agents: activities,
    }),
  )
  const documents: Readonly<Record<string, string>> = {
    identify: 'identify.md',
    [chain.writer]: chain.document,
    [chain.firstReviewer]: chain.firstReview,
    [chain.secondReviewer]: chain.secondReview,
  }
  const attempts = new Map<string, number>()
  let writes: readonly TWrite[] = []
  let calls: readonly TCall[] = []
  const write = (
    activity: string,
    attempt: number,
    document: string,
    operation: TOperation = 'ordinary',
  ): void => {
    const path = join(handoff, document)
    const result = safeParseSettlement(() => {
      if (operation === 'delete') {
        rmSync(path)
        return
      }
      if (operation === 'overwrite') chmodSync(path, 0o644)
      writeFileSync(path, `${activity} v${attempt}`)
    })
    writes = [
      ...writes,
      {
        activity,
        attempt,
        document,
        outcome:
          result.status === 'ok'
            ? 'written'
            : (result.error as NodeJS.ErrnoException).code,
      },
    ]
  }
  const response = (name: string, attempt: number): TEnvelopeBase => {
    if (name === 'identify') return genericOutput.schema.parse(CONTEXT)
    if (name === chain.writer) {
      const schema =
        chain.output === 'planOutput' ? planOutputSchema : buildOutputSchema
      return schema.parse({
        ...CONTEXT,
        summary: `${name} v${attempt}`,
        changed_files: [join(handoff, chain.document)],
      })
    }
    const approved = attempt > rejections
    return reviewOutputSchema.parse({
      ...CONTEXT,
      approved,
      blocking: approved ? [] : ['revise the deliverable'],
      findings: approved
        ? []
        : [
            {
              requirement: 'revise the deliverable',
              met: false,
              evidence: `${chain.document}:1`,
            },
          ],
    })
  }
  const ports: TAgentPorts = {
    run: (request) => {
      const activity = request.model.slice('fixture/'.length)
      const attempt = (attempts.get(activity) ?? 0) + 1
      attempts.set(activity, attempt)
      calls = [
        ...calls,
        {
          activity,
          attempt,
          saw: Object.fromEntries(
            readdirSync(handoff)
              .filter((path) => path.endsWith('.md'))
              .toSorted()
              .map((path) => [path, readFileSync(join(handoff, path), 'utf8')]),
          ),
        },
      ]
      write(activity, attempt, z.string().parse(documents[activity]))
      if (attempt === 2 && action?.activity === activity) {
        write(activity, attempt, action.document, action.operation)
      }
      return Promise.resolve({
        text: JSON.stringify(response(activity, attempt)),
        returncode: 0,
        sessionId: 'fixture',
        tokens: 0,
        cost: 0,
        usage: emptyUsage,
        contextTokens: 0,
        contextWindow: 0,
      })
    },
    changed: () => [],
    untracked: () => [],
    render: (_path, variables) => JSON.stringify(variables),
    savePrompt: (directory, name) => join(directory, name),
    snapshot: () => ({}),
    rev: () => '',
    head: () => '',
    history: () => () => [],
    content: () => ({ status: 'ok', data: {} }),
  }
  const args = {
    prompt: 'implement the request',
    config,
    commit: 'false',
    trustLevel: '100',
    runId: 'abcd1234',
    base: undefined,
    resume: false,
    activities: undefined,
    lifecycle: undefined,
    models: undefined,
    approveAfter: undefined,
    stream: false,
    handoff: undefined,
    name: undefined,
  }
  silenceTerminal()
  return {
    execute: () =>
      runWorkflow(
        args,
        chain.stages.map((stage) => ({
          ...stage,
          activities: [...stage.activities],
        })),
        ports,
        () => ({ provider: 'fixture', modelId: 'model' }),
        async () => false,
      ),
    content: (document: string) =>
      readFileSync(join(handoff, document), 'utf8'),
    outcome: (activity: string, attempt: number, document: string) =>
      writes.find(
        (one) =>
          one.activity === activity &&
          one.attempt === attempt &&
          one.document === document,
      )?.outcome,
    saw: (activity: string, attempt: number, document: string) =>
      calls.find((one) => one.activity === activity && one.attempt === attempt)
        ?.saw[document],
    events: (name: string, type = 'artifacts') =>
      eventsNamed(dbPath, name, type),
    [Symbol.dispose]: () => {
      for (const [key, value] of before) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          // biome-ignore lint/plugin/no-array-mutation: this fixture owns the process.env boundary and restores its original values
          process.env[key] = value
        }
      }
      rmSync(dir, { recursive: true, force: true })
      restoreTerminal()
    },
  }
}

for (const chain of CHAINS) {
  test(
    [
      `given C1 a rejected ${chain.writer} document`,
      `when ${chain.round} rewrites it in two successive rounds`,
      'it should keep both revisions, record their ownership, and finish successfully',
    ].join(', '),
    async () => {
      // given
      using fixture = fixtureWith(chain, 2)

      // when
      const actual = await fixture.execute()

      // then
      expect(fixture.outcome(chain.writer, 2, chain.document)).toBe('written')
      expect(fixture.outcome(chain.writer, 3, chain.document)).toBe('written')
      expect(fixture.saw(chain.firstReviewer, 2, chain.document)).toBe(
        `${chain.writer} v2`,
      )
      expect(fixture.content(chain.document)).toBe(`${chain.writer} v3`)
      const artifacts = fixture.events(`${chain.round} artifacts`)
      expect(artifacts).toHaveLength(2)
      for (const event of artifacts) {
        expect(event.payload.modified).toEqual([chain.document])
        expect(event.activity_run_id.endsWith(`_${chain.round}`)).toBe(true)
      }
      expect(fixture.events(`${chain.round} restored`)).toHaveLength(0)
      expect(terminalOutput()).not.toContain('restored')
      expect(actual).toBe(EXIT.SUCCESS)
    },
  )

  test(
    [
      `given C2 a revised ${chain.writer} document`,
      'when the first re-asked reviewer makes an ordinary write to it',
      'it should refuse the write and keep the revision',
    ].join(', '),
    async () => {
      // given
      using fixture = fixtureWith(chain, 1, {
        activity: chain.firstReviewer,
        document: chain.document,
        operation: 'ordinary',
      })

      // when
      await fixture.execute()

      // then
      expect(fixture.outcome(chain.firstReviewer, 2, chain.document)).toBe(
        'EACCES',
      )
      expect(fixture.content(chain.document)).toBe(`${chain.writer} v2`)
      expect(fixture.events(chain.round, 'activity_run_start')).toHaveLength(1)
      expect(fixture.events(`${chain.round} restored`)).toHaveLength(0)
    },
  )

  test(
    [
      `given C3 a revised ${chain.writer} document`,
      'when the second re-asked reviewer forces an overwrite',
      'it should restore the revision and attribute the damage to that reviewer',
    ].join(', '),
    async () => {
      // given
      using fixture = fixtureWith(chain, 1, {
        activity: chain.secondReviewer,
        document: chain.document,
        operation: 'overwrite',
      })

      // when
      await fixture.execute()

      // then
      expect(fixture.content(chain.document)).toBe(`${chain.writer} v2`)
      const restored = fixture.events(`${chain.secondReviewer} restored`)
      expect(restored).toHaveLength(1)
      expect(restored[0]?.payload.restored).toEqual([chain.document])
      expect(fixture.events(chain.round, 'activity_run_start')).toHaveLength(1)
      expect(fixture.events(`${chain.round} restored`)).toHaveLength(0)
    },
  )

  test(
    [
      `given C4 a revised ${chain.writer} document`,
      'when the second re-asked reviewer deletes it',
      'it should restore the revision and attribute the damage to that reviewer',
    ].join(', '),
    async () => {
      // given
      using fixture = fixtureWith(chain, 1, {
        activity: chain.secondReviewer,
        document: chain.document,
        operation: 'delete',
      })

      // when
      await fixture.execute()

      // then
      expect(fixture.content(chain.document)).toBe(`${chain.writer} v2`)
      const restored = fixture.events(`${chain.secondReviewer} restored`)
      expect(restored).toHaveLength(1)
      expect(restored[0]?.payload.restored).toEqual([chain.document])
      expect(fixture.events(chain.round, 'activity_run_start')).toHaveLength(1)
      expect(fixture.events(`${chain.round} restored`)).toHaveLength(0)
    },
  )

  test(
    [
      `given C5 ${chain.round} and an earlier identify document`,
      'when the writer makes an ordinary write to identify.md',
      'it should refuse the write and keep the identify document',
    ].join(', '),
    async () => {
      // given
      using fixture = fixtureWith(chain, 1, {
        activity: chain.writer,
        document: 'identify.md',
        operation: 'ordinary',
      })

      // when
      await fixture.execute()

      // then
      expect(fixture.outcome(chain.writer, 2, 'identify.md')).toBe('EACCES')
      expect(fixture.content('identify.md')).toBe('identify v1')
      expect(fixture.events(chain.round, 'activity_run_start')).toHaveLength(1)
      expect(fixture.events(`${chain.round} restored`)).toHaveLength(0)
    },
  )

  test(
    [
      `given C6 ${chain.round} and the first reviewer's document`,
      'when the writer makes an ordinary write to that review',
      'it should refuse the write and let the reviewer read its original',
    ].join(', '),
    async () => {
      // given
      using fixture = fixtureWith(chain, 1, {
        activity: chain.writer,
        document: chain.firstReview,
        operation: 'ordinary',
      })

      // when
      await fixture.execute()

      // then
      expect(fixture.outcome(chain.writer, 2, chain.firstReview)).toBe('EACCES')
      expect(fixture.saw(chain.firstReviewer, 2, chain.firstReview)).toBe(
        `${chain.firstReviewer} v1`,
      )
      expect(fixture.events(chain.round, 'activity_run_start')).toHaveLength(1)
      expect(fixture.events(`${chain.round} restored`)).toHaveLength(0)
    },
  )

  test(
    [
      `given C7 ${chain.round} and an earlier identify document`,
      'when the writer forces an overwrite of identify.md',
      'it should restore identify before review without undoing the writer revision',
    ].join(', '),
    async () => {
      // given
      using fixture = fixtureWith(chain, 1, {
        activity: chain.writer,
        document: 'identify.md',
        operation: 'overwrite',
      })

      // when
      await fixture.execute()

      // then
      expect(fixture.saw(chain.firstReviewer, 2, 'identify.md')).toBe(
        'identify v1',
      )
      const restored = fixture.events(`${chain.round} restored`)
      expect(restored).toHaveLength(1)
      expect(restored[0]?.payload.restored).toEqual(['identify.md'])
      expect(restored[0]?.activity_run_id.endsWith(`_${chain.round}`)).toBe(
        true,
      )
      expect(fixture.content(chain.document)).toBe(`${chain.writer} v2`)
    },
  )

  test(
    [
      `given C8 ${chain.round} and the second reviewer's document`,
      'when the writer deletes that review',
      'it should restore the review before the first reviewer is re-asked',
    ].join(', '),
    async () => {
      // given
      using fixture = fixtureWith(chain, 1, {
        activity: chain.writer,
        document: chain.secondReview,
        operation: 'delete',
      })

      // when
      await fixture.execute()

      // then
      expect(fixture.saw(chain.firstReviewer, 2, chain.secondReview)).toBe(
        `${chain.secondReviewer} v1`,
      )
      const restored = fixture.events(`${chain.round} restored`)
      expect(restored).toHaveLength(1)
      expect(restored[0]?.payload.restored).toEqual([chain.secondReview])
    },
  )
}
