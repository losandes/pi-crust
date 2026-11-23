import { resolve } from 'node:path'
import { z } from 'zod'
import {
  stageFromWritten,
  type TLifecycleFault,
  writtenStageFaults,
  writtenStageSchema,
} from '../../../../lib/contracts'
import {
  ENTRY_SECTIONS,
  type TConfigLayer,
  type TEntrySection,
  type TTomlDocument,
} from '../typedefs/config-layer'
import { firstDeclaringLayer } from './layer-lookup'
import { mergeLayers, tableOf } from './merge-layers'

export type TAssembledConfig = Readonly<{
  document: TTomlDocument
  faults: readonly TLifecycleFault[]
}>
const entriesSchema = z.record(z.string(), z.record(z.string(), z.unknown()))

const promptDirectory = (
  root: string,
  section: TEntrySection,
  name: string,
  value: unknown,
): string => {
  const parsed = z.string().safeParse(value ?? `prompts/${name}`)
  if (!parsed.success)
    throw new Error(
      `${section}.${name}.prompts: expected one prompt directory string`,
    )
  return resolve(root, parsed.data)
}

export const assembleConfig = (
  layers: readonly TConfigLayer[],
): TAssembledConfig => {
  const merged = layers.reduce<TTomlDocument>(
    (document, layer) => mergeLayers(document, layer.document),
    {},
  )
  const entries = (section: TEntrySection): readonly TTomlDocument[] => {
    const parsed = entriesSchema.safeParse(merged[section] ?? {})
    if (!parsed.success)
      throw new Error(
        parsed.error.issues
          .map(
            (issue) =>
              `${[section, ...issue.path].join('.')}: ${issue.message}`,
          )
          .join('\n'),
      )
    const table = parsed.data
    const names = Object.keys(table).toSorted((a, b) => {
      const group = (name: string): number => {
        const owner = firstDeclaringLayer(layers, section, name)
        return owner === undefined ? -1 : layers.indexOf(owner)
      }
      return group(a) - group(b) || (a < b ? -1 : a > b ? 1 : 0)
    })
    return names.map((name) => {
      const entry = tableOf(table[name])
      const root =
        firstDeclaringLayer(layers, section, name)?.promptRoot ?? process.cwd()
      return {
        ...entry,
        name,
        ...(section === 'lifecycles'
          ? {}
          : {
              prompts: promptDirectory(root, section, name, entry.prompts),
            }),
      }
    })
  }
  const sections = Object.fromEntries(
    ENTRY_SECTIONS.map((section) => [section, entries(section)]),
  )
  const lifecycles = sections.lifecycles ?? []
  const faults = lifecycles.flatMap((entry) =>
    writtenStageFaults(String(entry.name), entry.stages),
  )
  return {
    document: {
      ...merged,
      ...sections,
      agents: [
        ...(sections.activities ?? []),
        ...(sections.planners ?? []),
        ...(sections.terminal ?? []),
      ],
      observability: Object.fromEntries(
        ['db', 'poll_ms', 'ports']
          .filter((key) => Object.hasOwn(merged, key))
          .map((key) => [key, merged[key]]),
      ),
      lifecycles:
        faults.length > 0
          ? []
          : lifecycles.map((entry) => ({
              ...entry,
              stages: z
                .array(writtenStageSchema)
                .parse(entry.stages)
                .map(stageFromWritten),
            })),
    },
    faults,
  }
}
