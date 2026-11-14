import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TCliArgs, TWorkflowArgs } from '../domains/cli'
import { plannedNames } from '../domains/planning'
import { crustConfigSchema } from '../lib/contracts'
import { main, plannedActivities, runFromCli } from './compose'

const args = (over: Partial<TWorkflowArgs>): TWorkflowArgs => ({
  prompt: 'x',
  config: '.pi-crust/config/crust.config.yaml',
  runId: undefined,
  base: undefined,
  resume: false,
  activities: undefined,
  lifecycle: undefined,
  models: undefined,
  approveAfter: undefined,
  commit: undefined,
  stream: false,
  trustLevel: undefined,
  handoff: undefined,
  name: undefined,
  ...over,
})

const cfg = crustConfigSchema.parse({
  activities: ['identify', 'conceptualize', 'plan', 'test', 'build'].map(
    (name) => ({
      name,
      purpose: `Do the ${name} work and report it`,
      prompt_engineering: { system: 's.md', user: 'u.md' },
    }),
  ),
})

const lifecyclesFile = (yaml: string) => {
  const path = join(
    mkdtempSync(join(tmpdir(), 'crust-compose-')),
    'crust.lifecycles.yaml',
  )
  writeFileSync(path, yaml)
  return path
}

const SDLC = `
lifecycles:
  - name: sdlc
    stages:
      - name: discover
        activities: [identify, conceptualize]
      - name: implement
        activities: [build]
`

test(
  [
    'given lifecycles/compose::plannedActivities',
    'when a lifecycle is named',
    'it should plan the stages it declares, in the order it declares them',
  ].join(', '),
  () => {
    // given
    const given = lifecyclesFile(SDLC)

    // when
    const actual = plannedActivities(args({ lifecycle: 'sdlc' }), cfg, given)

    // then
    expect(actual.map((stage) => stage.name)).toEqual(['discover', 'implement'])
    expect(plannedNames(actual)).toEqual(['identify', 'conceptualize', 'build'])
  },
)

test(
  [
    'given lifecycles/compose::plannedActivities',
    'when activities are spelled out instead',
    'it should run exactly those, in the order given',
  ].join(', '),
  () => {
    // given
    const given = args({ activities: 'plan,test,build' })

    // when
    const actual = plannedActivities(given, cfg)

    // then
    expect(plannedNames(actual)).toEqual(['plan', 'test', 'build'])
    expect(actual).toHaveLength(1)
    expect(actual[0]?.strategy).toEqual('serial')
  },
)

test(
  [
    'given lifecycles/compose::plannedActivities',
    'when both a lifecycle and an activity chain are given',
    'it should refuse rather than apply a precedence nobody remembers',
  ].join(', '),
  () => {
    // given
    const given = args({ lifecycle: 'sdlc', activities: 'plan' })

    // when
    const actual = () => plannedActivities(given, cfg)

    // then
    expect(actual).toThrow(/not both/)
  },
)

test(
  [
    'given lifecycles/compose::plannedActivities',
    'when the named lifecycle does not exist',
    'it should say what this repository does offer',
  ].join(', '),
  () => {
    // given
    const given = lifecyclesFile(SDLC)

    // when
    const actual = () =>
      plannedActivities(args({ lifecycle: 'nope' }), cfg, given)

    // then
    expect(actual).toThrow(/sdlc/)
  },
)

test(
  [
    'given lifecycles/compose::plannedActivities',
    'when a named lifecycle declares no activities',
    'it should refuse rather than start a run that does nothing',
  ].join(', '),
  () => {
    // given
    const given = lifecyclesFile(`
lifecycles:
  - name: empty
    stages: []
`)

    // when
    const actual = () =>
      plannedActivities(args({ lifecycle: 'empty' }), cfg, given)

    // then
    expect(actual).toThrow(/no activities/)
  },
)

test(
  [
    'given lifecycles/compose::plannedActivities',
    'when a chain names a Planner',
    'it should refuse, because a Lifecycle names Activities and a Planner is not one',
  ].join(', '),
  () => {
    // given
    const given = args({ activities: 'plan,operator' })

    // when
    const actual = () => plannedActivities(given, cfg)

    // then
    expect(actual).toThrow(/operator cannot be named in a chain/)
  },
)

test(
  [
    'given lifecycles/compose::plannedActivities',
    'when a chain names something this repository does not register',
    'it should refuse at the call site, where the compiler used to',
  ].join(', '),
  () => {
    // given
    const given = args({ activities: 'plan,deploy' })

    // when
    const actual = () => plannedActivities(given, cfg)

    // then
    expect(actual).toThrow(/unknown activity\(s\): deploy/)
  },
)

test(
  [
    'given lifecycles/compose::plannedActivities',
    'when neither a lifecycle nor a chain was named',
    'it should name BOTH routes, because either one answers the question',
  ].join(', '),
  () => {
    // given — the message used to describe only --activities, which reads as
    // "you must list activities" to somebody who asked for a Lifecycle
    const given = args({})

    // when
    const actual = () => plannedActivities(given, cfg)

    // then
    expect(actual).toThrow(/--lifecycle/)
    expect(actual).toThrow(/--activities/)
    expect(actual).toThrow(/just crust list/)
  },
)

test(
  [
    'given lifecycles/compose::main',
    'when the named lifecycle is not one the repository offers',
    'it should report the error and exit 2 without starting a run',
  ].join(', '),
  () => {
    // given
    const configPath = join(
      mkdtempSync(join(tmpdir(), 'crust-compose-main-')),
      'crust.config.yaml',
    )
    writeFileSync(
      configPath,
      [
        'activities:',
        '  - name: identify',
        "    purpose: 'Do the identify work and report it'",
        '    prompt_engineering: { system: s.md, user: u.md }',
        '',
      ].join('\n'),
    )
    const original = process.stderr.write.bind(process.stderr)
    let printed = ''
    // biome-ignore lint/plugin/no-object-mutation: swapping Node's own stderr.write for the capture, restored below
    process.stderr.write = ((chunk: string) => {
      printed += chunk
      return true
    }) as typeof process.stderr.write

    // when
    const actual = main(
      args({ config: configPath, lifecycle: 'does-not-exist' }),
    )

    // then
    return actual.then((code) => {
      // biome-ignore lint/plugin/no-object-mutation: restoring Node's own stderr.write after the capture
      process.stderr.write = original
      expect(code).toEqual(2)
      expect(printed).toContain('unknown lifecycle')
    })
  },
)

test(
  [
    'given lifecycles/compose::runFromCli',
    'when the parsed args name an unknown lifecycle',
    "it should resolve the prompt and delegate to main, which reports main's own error",
  ].join(', '),
  () => {
    // given
    const configPath = join(
      mkdtempSync(join(tmpdir(), 'crust-compose-run-from-cli-')),
      'crust.config.yaml',
    )
    writeFileSync(
      configPath,
      [
        'activities:',
        '  - name: identify',
        "    purpose: 'Do the identify work and report it'",
        '    prompt_engineering: { system: s.md, user: u.md }',
        '',
      ].join('\n'),
    )
    const original = process.stderr.write.bind(process.stderr)
    let printed = ''
    // biome-ignore lint/plugin/no-object-mutation: swapping Node's own stderr.write for the capture, restored below
    process.stderr.write = ((chunk: string) => {
      printed += chunk
      return true
    }) as typeof process.stderr.write
    const cliArgs = args({
      config: configPath,
      lifecycle: 'does-not-exist',
    }) as TCliArgs

    // when
    const actual = runFromCli(cliArgs)

    // then
    return actual.then((code) => {
      // biome-ignore lint/plugin/no-object-mutation: restoring Node's own stderr.write after the capture
      process.stderr.write = original
      expect(code).toEqual(2)
      expect(printed).toContain('unknown lifecycle')
    })
  },
)
