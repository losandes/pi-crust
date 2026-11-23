import { z } from 'zod'

export type TLayerDocument = Readonly<{ file: string; document: unknown }>

const recordSchema = z.record(z.string(), z.unknown())
const record = (value: unknown): Readonly<Record<string, unknown>> => {
  const parsed = recordSchema.safeParse(value)
  return parsed.success ? parsed.data : {}
}
const entries = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : []
const label = (
  entry: Readonly<Record<string, unknown>>,
  index: number,
): string => (typeof entry.name === 'string' ? entry.name : String(index))

const routingReplacement = {
  checks:
    'tasks replace routing.checks. Declare each command under `tasks:` with `when: [{ on: change }]`, `match` and `run` (references/config.md, Tasks); delete this key.',
  unmatched:
    'tasks replace routing.checks, and the unmatched-path policy went with it: a run reports how many changed paths no task matched and never fails on it; delete this key.',
  skills:
    'skill routing was removed. A skill belongs where the coding agent discovers skills; delete this key.',
} as const
const commandsGateReplacement =
  'the `checks` gate was removed. Repository commands are tasks (`tasks:`) that fire at `change` after any Activity; delete this key.'
const gatesReplacement =
  'per-Activity gate lists were removed. Output checks now follow from what the Activity reports (its `output`); delete this key.'

/** One line per removed setting, in layer order then document order. */
export const removedSettingFaults = (
  layers: readonly TLayerDocument[],
): readonly string[] =>
  layers.flatMap(({ file, document }) =>
    Object.entries(record(document)).flatMap(([section, value]) => {
      if (section === 'routing') {
        const routing = record(value)
        const faults = Object.keys(routing).flatMap((key) =>
          key === 'checks' || key === 'unmatched' || key === 'skills'
            ? [`${file}: routing.${key} — ${routingReplacement[key]}`]
            : [],
        )
        return Object.hasOwn(routing, 'checks') ||
          Object.hasOwn(routing, 'unmatched')
          ? faults
          : [
              ...faults,
              `${file}: routing — the section was removed and tasks (\`tasks:\`) replace it; delete this key.`,
            ]
      }
      return section === 'activities' || section === 'agents'
        ? entries(value).flatMap((entry, index) => {
            const activity = record(entry)
            return Object.hasOwn(activity, 'gates')
              ? [
                  `${file}: ${section}[${label(activity, index)}].gates — ${entries(activity.gates).includes('checks') ? commandsGateReplacement : gatesReplacement}`,
                ]
              : []
          })
        : []
    }),
  )
