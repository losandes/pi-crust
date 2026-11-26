import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse } from 'smol-toml'
import {
  resolveRunDirectory,
  sessionsDirIn,
} from '../../../../../lib/run-directories'
import type { TStage } from '../../../../lib/contracts'
import { configText, tomlText } from '../../../../testing/config-document'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { shippedConfig } from '../../../../testing/shipped-layer'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import type { TAgentPorts } from '../../../activities'
import { emptyUsage } from '../../../agents'
import { loadConfig } from '../../../config'
import { loadLifecycles } from '../../../planning'
import { readRunState } from '../../../trace'
import { runWorkflow } from './run-workflow'

const stages: readonly TStage[] = [
  { name: 'deliver', strategy: 'serial', activities: ['import', 'build'] },
]
const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-workflow-import-'))
  const cwd = process.cwd()
  const environment = {
    machine: process.env.CRUST_MACHINE_CONFIG ?? '',
    data: process.env.CRUST_DATA_DIR ?? '',
  }
  const registry = shippedConfig().activities.filter(
    (activity) => activity.name !== 'build',
  )
  silenceTerminal()
  process.chdir(dir)
  execFileSync('git', ['init', '-q', '-b', 'test'], { cwd: dir })
  const source = join(dir, 'source.md')
  writeFileSync(source, '---\n> _Handoff: Plan_\n---\n\nfirst plan\n')
  execFileSync('git', ['add', 'source.md'], { cwd: dir })
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'fixture',
    ],
    { cwd: dir },
  )
  // biome-ignore lint/plugin/no-object-mutation: the fixture owns the process environment consumed by the config boundary
  process.env.CRUST_MACHINE_CONFIG = join(dir, 'absent-machine')
  // biome-ignore lint/plugin/no-object-mutation: the fixture owns the process environment consumed by the config boundary
  process.env.CRUST_DATA_DIR = ''
  const data = join(dir, 'data')
  const config = join(dir, 'pi-crust.toml')
  const system = join(dir, 'system.md')
  const user = join(dir, 'user.md')
  writeFileSync(system, 'system')
  writeFileSync(user, 'user')
  writeFileSync(
    config,
    configText({
      defaults: { data_dir: data },
      observability: {},
      agents: [
        {
          name: 'build',
          purpose: 'Build the requested work',
          model: 'test/model',
          tools: [],
          writes: [],
          prompts: dirname(system),
        },
      ],
      activities: [
        ...registry,
        {
          name: 'build',
          purpose: 'Build the requested work',
          output: 'genericOutput',
          model: 'test/model',
          tools: [],
          writes: [],
          prompts: dirname(system),
        },
      ],
    }),
  )
  const args: Parameters<typeof runWorkflow>[0] = {
    prompt: 'source.md',
    config,
    runId: 'aa150001',
    base: undefined,
    resume: false,
    activities: undefined,
    lifecycle: undefined,
    models: undefined,
    approveAfter: undefined,
    commit: 'false',
    stream: false,
    trustLevel: '100',
    handoff: undefined,
    name: undefined,
  }
  const received = new Map<number, Readonly<Record<string, string>>>()
  const ports: TAgentPorts = {
    run: async () => ({
      text: JSON.stringify({ status: 'success', summary: 'built' }),
      returncode: 0,
      sessionId: '',
      tokens: 0,
      cost: 0,
      usage: emptyUsage,
      contextTokens: 0,
      contextWindow: 0,
    }),
    changed: () => [],
    untracked: () => [],
    snapshot: () => ({}),
    rev: () => '',
    head: () => '',
    history: () => () => [],
    content: () => ({ status: 'ok', data: {} }),
    render: (_path, variables) => {
      received.set(received.size, variables)
      return 'rendered'
    },
    savePrompt: (directory, name) => join(directory, name),
  }
  const run = (
    plan = stages,
    override: Partial<typeof args> = {},
    agent = ports,
  ) =>
    runWorkflow(
      { ...args, ...override },
      plan,
      agent,
      () => ({ provider: 'test', modelId: 'model' }),
      async () => false,
    )
  return {
    dir,
    source,
    args,
    ports,
    get received() {
      return [...received.values()]
    },
    run,
    get handoff() {
      return join(
        resolveRunDirectory({
          dbPath: join(data, 'crust.db'),
          sessionsDir: sessionsDirIn(data),
        })(args.runId ?? ''),
        'context_handoff',
      )
    },
    state: () => readRunState(join(data, 'crust.db'), args.runId),
    [Symbol.dispose]: () => {
      process.chdir(cwd)
      restoreTerminal()
      // biome-ignore lint/plugin/no-object-mutation: restore environment owned by this fixture
      process.env.CRUST_MACHINE_CONFIG = environment.machine
      // biome-ignore lint/plugin/no-object-mutation: restore environment owned by this fixture
      process.env.CRUST_DATA_DIR = environment.data
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given SC6 an imported plan',
    'when the builder starts',
    'it should receive the import as previous and upstream work',
  ].join(', '),
  async () => {
    // given
    using given = fixture()
    // when
    const actual = await given.run()
    // then
    expect(actual).toBe(0)
    expect(readFileSync(join(given.handoff, 'plan.md'), 'utf8')).toBe(
      'first plan\n',
    )
    expect(given.received[0]?.previous_envelope).toContain('plan.md')
    expect(given.received[0]?.previous_envelopes).toContain('## from import')
    expect(
      given
        .state()
        ?.envelopes.find((envelope) => envelope.output_type === 'ImportOutput')
        ?.agent,
    ).toBe('import')
  },
)

for (const request of ['missing.md', 'source.md other.md']) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      'given SC8 and SC21 an invalid source request',
      `when importing ${request}`,
      'it should fail before the builder starts',
    ].join(', '),
    async () => {
      // given
      using given = fixture()
      // when, then
      await expect(given.run(stages, { prompt: request })).rejects.toThrow(
        request === 'missing.md'
          ? 'does not exist'
          : 'the request names 2 sources',
      )
      expect(given.received).toHaveLength(0)
      expect(
        given.state()?.activityRuns.find((row) => row.name === 'import'),
      ).toMatchObject({ status: 'fail' })
    },
  )
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given SC9 an earlier handoff plan',
    'when the source carries a replacement',
    'it should retain the earlier bytes and report present',
  ].join(', '),
  async () => {
    // given
    using given = fixture()
    mkdirSync(given.handoff, { recursive: true })
    writeFileSync(join(given.handoff, 'plan.md'), 'earlier bytes')
    // when
    await given.run()
    // then
    expect(readFileSync(join(given.handoff, 'plan.md'), 'utf8')).toBe(
      'earlier bytes',
    )
    expect(
      given
        .state()
        ?.envelopes.find((envelope) => envelope.output_type === 'ImportOutput')
        ?.payload.documents,
    ).toMatchObject([{ status: 'present' }])
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given SC10 a failed builder after import',
    'when resuming after a source edit',
    'it should replay the first import and not read the source',
  ].join(', '),
  async () => {
    // given
    using given = fixture()
    await expect(
      given.run(
        stages,
        {},
        {
          ...given.ports,
          run: () => Promise.reject(new Error('builder failed')),
        },
      ),
    ).rejects.toThrow('builder failed')
    const first = given.received[0]?.previous_envelope
    writeFileSync(given.source, 'changed source')
    // when
    const actual = await given.run(stages, { resume: true })
    // then
    expect(actual).toBe(0)
    expect(readFileSync(join(given.handoff, 'plan.md'), 'utf8')).toBe(
      'first plan\n',
    )
    expect(given.received.at(-1)?.previous_envelope).toBe(first)
    expect(
      given.state()?.activityRuns.filter((row) => row.name === 'import'),
    ).toHaveLength(1)
  },
)

for (const importing of [false, true]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      'given SC11 no referenced work',
      `when import is ${importing ? 'enabled' : 'disabled'}`,
      'it should hand the builder no upstream work',
    ].join(', '),
    async () => {
      // given
      using given = fixture()
      // when
      const actual = await given.run(
        [
          {
            name: 'build',
            strategy: 'serial',
            activities: importing ? ['import', 'build'] : ['build'],
          },
        ],
        { prompt: 'build a feature' },
      )
      // then
      expect(actual).toBe(0)
      expect(given.received[0]?.previous_envelope).toBe('(none)')
      expect(
        given.state()?.activityRuns.filter((row) => row.name === 'import'),
      ).toHaveLength(importing ? 1 : 0)
      expect(existsSync(join(given.handoff, 'imported-work.md'))).toBe(false)
    },
  )
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given SC20 uncommitted source edits',
    'when importing',
    'it should use the on-disk bytes and record HEAD and digest',
  ].join(', '),
  async () => {
    // given
    using given = fixture()
    writeFileSync(given.source, '---\n> _Handoff: Plan_\n---\n\nedited plan\n')
    // when
    await given.run()
    // then
    expect(readFileSync(join(given.handoff, 'plan.md'), 'utf8')).toBe(
      'edited plan\n',
    )
    expect(
      given
        .state()
        ?.envelopes.find((envelope) => envelope.output_type === 'ImportOutput')
        ?.payload.source,
    ).toMatchObject({
      kind: 'document',
      differs_from_head: true,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      head: expect.stringMatching(/^[a-f0-9]{40}$/),
    })
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given SC12 a Lifecycle enabled by hand',
    'when loading only the documented import edit',
    'it should deliver the imported plan to the builder',
  ].join(', '),
  async () => {
    // given
    using given = fixture()
    const path = given.args.config
    const repository = parse(readFileSync(path, 'utf8'))
    writeFileSync(
      path,
      tomlText({
        ...repository,
        lifecycles: {
          'ship-plan': {
            stages: [{ name: 'deliver', serial: ['import', 'build'] }],
          },
        },
      }),
    )
    // when
    const loaded = loadLifecycles(loadConfig(given.args.config))
    await given.run(loaded[0]?.stages ?? [])
    // then
    expect(given.received[0]?.previous_envelope).toContain('plan.md')
  },
)
