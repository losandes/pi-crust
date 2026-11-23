/** Encode loaded-shape test fixtures as one repository TOML document. */
import { z } from 'zod'
import { isPlannerName, isTerminalName } from '../lib/contracts'

const recordSchema = z.record(z.string(), z.unknown())
const record = (value: unknown): Readonly<Record<string, unknown>> =>
  recordSchema.parse(value)
const namedEntries = (value: unknown): Readonly<Record<string, unknown>> => {
  if (!Array.isArray(value)) return value === undefined ? {} : record(value)
  return Object.fromEntries(
    value.map((item: unknown) => {
      const { name, ...entry } = record(item)
      return [z.string().parse(name), entry]
    }),
  )
}

export const repositoryDocument = (
  document: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => {
  const {
    agents,
    observability,
    activities,
    planners,
    terminal,
    lifecycles,
    ...rest
  } = document
  const roster = Array.isArray(agents) ? agents.map(record) : []
  const section = (
    value: unknown,
    belongs: (name: string) => boolean,
  ): Readonly<Record<string, unknown>> =>
    namedEntries(value ?? roster.filter((entry) => belongs(String(entry.name))))
  const agentSection = (
    entries: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, unknown>> =>
    Object.fromEntries(
      Object.entries(entries).map(([name, value]) => [
        name,
        { prompts: '.', writes: [], ...record(value) },
      ]),
    )
  const plannerEntries = section(planners, isPlannerName)
  const terminalEntries = section(terminal, isTerminalName)
  const fallback = { prompts: '.', writes: [] }
  return {
    ...rest,
    ...(observability === undefined ? {} : record(observability)),
    activities: agentSection(
      section(
        activities,
        (name) => !(isPlannerName(name) || isTerminalName(name)),
      ),
    ),
    planners: agentSection({
      operator: fallback,
      triage: fallback,
      ...plannerEntries,
    }),
    terminal: agentSection({ 'gh-pull-request': fallback, ...terminalEntries }),
    ...(lifecycles === undefined
      ? {}
      : {
          lifecycles: Object.fromEntries(
            Object.entries(namedEntries(lifecycles)).map(([name, value]) => {
              const entry = record(value)
              return [
                name,
                {
                  ...entry,
                  stages: Array.isArray(entry.stages)
                    ? entry.stages.map((value: unknown) => {
                        const { strategy, activities, ...stage } = record(value)
                        return activities === undefined
                          ? stage
                          : {
                              ...stage,
                              [z.string().parse(strategy ?? 'serial')]:
                                activities,
                            }
                      })
                    : entry.stages,
                },
              ]
            }),
          ),
        }),
  }
}

export const tomlText = (document: Readonly<Record<string, unknown>>): string =>
  z.string().parse(Bun.TOML.stringify(document))

export const configText = (
  document: Readonly<Record<string, unknown>>,
): string => tomlText(repositoryDocument(document))
