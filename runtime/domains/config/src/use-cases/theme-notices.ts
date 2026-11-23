import { join } from 'node:path'
import type { TConfigLayer } from '../typedefs/config-layer'

export const themeNotices = (
  layers: readonly TConfigLayer[],
  machineDirectory: string,
): readonly string[] =>
  layers
    .filter((layer) => layer.name !== 'machine')
    .flatMap((layer) =>
      layer.files
        .filter((file) => Object.hasOwn(file.document, 'themes'))
        .map(
          (file) =>
            `${file.path}: themes are read only from ${join(machineDirectory, 'crust.config.toml')}; this table is ignored.`,
        ),
    )
