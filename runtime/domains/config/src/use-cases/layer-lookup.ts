import type {
  TConfigLayer,
  TEntrySection,
  TLayerFile,
} from '../typedefs/config-layer'
import { isTable, tableOf } from './merge-layers'

export const firstDeclaringLayer = (
  layers: readonly TConfigLayer[],
  section: TEntrySection,
  name: string,
): TConfigLayer | undefined =>
  layers.find((layer) => isTable(tableOf(layer.document[section])[name]))

export const valueAt = (value: unknown, keys: readonly string[]): unknown =>
  keys.reduce<unknown>((node, key) => tableOf(node)[key], value)

export const lastStatingFile = (
  layers: readonly TConfigLayer[],
  keys: readonly string[],
): TLayerFile | undefined =>
  layers
    .flatMap((layer) => layer.files)
    .findLast((file) => valueAt(file.document, keys) !== undefined)
