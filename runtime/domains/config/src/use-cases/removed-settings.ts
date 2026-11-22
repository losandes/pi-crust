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

const commandReplacement =
  'labels on repository commands were removed and nothing replaced them; delete this key.'
const gatesReplacement =
  'per-Activity gate lists were removed. Output checks now follow from what the Activity reports (its `output`); delete this key.'

/** One line per removed setting, in layer order then document order. */
export const removedSettingFaults = (
  layers: readonly TLayerDocument[],
): readonly string[] =>
  layers.flatMap(({ file, document }) =>
    Object.entries(record(document)).flatMap(([section, value]) => {
      if (section === 'routing') {
        return Object.entries(record(value)).flatMap(([key, setting]) => {
          if (key === 'skills') {
            return [
              `${file}: routing.skills — skill routing was removed. A skill belongs where the coding agent discovers skills; delete this key.`,
            ]
          }
          return key === 'checks'
            ? entries(setting).flatMap((entry, index) => {
                const check = record(entry)
                return Object.keys(check)
                  .filter((field) => field === 'operation' || field === 'area')
                  .map(
                    (field) =>
                      `${file}: routing.checks[${label(check, index)}].${field} — ${commandReplacement}`,
                  )
              })
            : []
        })
      }
      return section === 'activities' || section === 'agents'
        ? entries(value).flatMap((entry, index) => {
            const activity = record(entry)
            return Object.hasOwn(activity, 'gates')
              ? [
                  `${file}: ${section}[${label(activity, index)}].gates — ${gatesReplacement}`,
                ]
              : []
          })
        : []
    }),
  )
