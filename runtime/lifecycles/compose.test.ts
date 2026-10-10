import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TWorkflowArgs } from '../modules/use-cases/parse-cli'
import { plannedActivities } from './compose'

const args = (over: Partial<TWorkflowArgs>): TWorkflowArgs => ({
  prompt: 'x',
  config: '.pi-crust/config/crust.config.yaml',
  runId: undefined,
  agent: undefined,
  base: undefined,
  resume: false,
  steps: undefined,
  lifecycle: undefined,
  approveAfter: undefined,
  deliver: undefined,
  stream: false,
  trustLevel: undefined,
  ...over,
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
        depends_on: [discover]
`

test(
  [
    'given lifecycles/compose::plannedActivities',
    'when a lifecycle is named',
    'it should run the activities its stages and dependencies order',
  ].join(', '),
  () => {
    // given
    const given = lifecyclesFile(SDLC)

    // when
    const actual = plannedActivities(args({ lifecycle: 'sdlc' }), given)

    // then
    expect(actual).toEqual(['identify', 'conceptualize', 'build'])
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
    const given = args({ steps: 'plan,build,verify' })

    // when
    const actual = plannedActivities(given)

    // then
    expect(actual).toEqual(['plan', 'build', 'verify'])
  },
)

test(
  [
    'given lifecycles/compose::plannedActivities',
    'when both a lifecycle and a step list are given',
    'it should refuse rather than apply a precedence nobody remembers',
  ].join(', '),
  () => {
    // given
    const given = args({ lifecycle: 'sdlc', steps: 'plan' })

    // when
    const actual = () => plannedActivities(given)

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
    const actual = () => plannedActivities(args({ lifecycle: 'nope' }), given)

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
    const actual = () => plannedActivities(args({ lifecycle: 'empty' }), given)

    // then
    expect(actual).toThrow(/no activities/)
  },
)
