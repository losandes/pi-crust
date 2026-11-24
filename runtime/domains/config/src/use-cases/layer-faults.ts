import { LAYER_FILE_KEYS, type TConfigLayer } from '../typedefs/config-layer'

export const layerFaults = (
  layers: readonly TConfigLayer[],
): readonly string[] =>
  layers.flatMap((layer) =>
    layer.files.flatMap((file) =>
      Object.keys(file.document)
        .filter(
          (key) =>
            !(
              file.allowedKeys.includes(key) ||
              ['routing', 'override', 'db'].includes(key)
            ),
        )
        .map((key) => {
          const destination = Object.entries(LAYER_FILE_KEYS).find(([, keys]) =>
            keys.includes(key),
          )?.[0]
          return `${file.path}: unknown top-level key '${key}'; ${destination === undefined ? 'settings such as tasks belong only in pi-crust.toml' : `put it in ${destination} or pi-crust.toml`}`
        }),
    ),
  )
