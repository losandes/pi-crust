import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crustConfigSchema } from '../../../../lib/contracts'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import type { TWorkflowArgs } from '../../../cli'
import { plannedNames } from '../..'
import { plannedActivities } from './planned-activities'

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
      prompts: { system: 's.md', user: 'u.md' },
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
    'given planning::plannedActivities',
    'when a lifecycle is named',
    'it should plan the stages it declares, in the order it declares them',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const given = lifecyclesFile(SDLC)

      // when
      const actual = plannedActivities(args({ lifecycle: 'sdlc' }), cfg, given)

      // then
      expect(actual.map((stage) => stage.name)).toEqual([
        'discover',
        'implement',
      ])
      expect(plannedNames(actual)).toEqual([
        'identify',
        'conceptualize',
        'build',
      ])
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given planning::plannedActivities',
    'when activities are spelled out instead',
    'it should run exactly those, in the order given',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const given = args({ activities: 'plan,test,build' })

      // when
      const actual = plannedActivities(given, cfg)

      // then
      expect(plannedNames(actual)).toEqual(['plan', 'test', 'build'])
      expect(actual).toHaveLength(1)
      expect(actual[0]?.strategy).toEqual('serial')
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given planning::plannedActivities',
    'when both a lifecycle and an activity chain are given',
    'it should refuse rather than apply a precedence nobody remembers',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const given = args({ lifecycle: 'sdlc', activities: 'plan' })

      // when
      const actual = () => plannedActivities(given, cfg)

      // then
      expect(actual).toThrow(/not both/)
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given planning::plannedActivities',
    'when the named lifecycle does not exist',
    'it should say what this repository does offer',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const given = lifecyclesFile(SDLC)

      // when
      const actual = () =>
        plannedActivities(args({ lifecycle: 'nope' }), cfg, given)

      // then
      expect(actual).toThrow(/sdlc/)
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given planning::plannedActivities',
    'when a named lifecycle declares no activities',
    'it should refuse rather than start a run that does nothing',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
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
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given planning::plannedActivities',
    'when a chain names a Planner',
    'it should refuse, because a Lifecycle names Activities and a Planner is not one',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const given = args({ activities: 'plan,operator' })

      // when
      const actual = () => plannedActivities(given, cfg)

      // then
      expect(actual).toThrow(/operator cannot be named in a chain/)
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given planning::plannedActivities',
    'when a chain names something this repository does not register',
    'it should refuse at the call site, where the compiler used to',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const given = args({ activities: 'plan,deploy' })

      // when
      const actual = () => plannedActivities(given, cfg)

      // then
      expect(actual).toThrow(/unknown activity\(s\): deploy/)
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given planning::plannedActivities',
    'when neither a lifecycle nor a chain was named',
    'it should name BOTH routes, because either one answers the question',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given — the message used to describe only --activities, which reads as
      // "you must list activities" to somebody who asked for a Lifecycle
      const given = args({})

      // when
      const actual = () => plannedActivities(given, cfg)

      // then
      expect(actual).toThrow(/--lifecycle/)
      expect(actual).toThrow(/--activities/)
      expect(actual).toThrow(/just crust list/)
    } finally {
      restoreTerminal()
    }
  },
)
