export { layersFixture } from '../../../../testing/config-layers'

import type {
  TConfigLayer,
  TLayerName,
  TTomlDocument,
} from '../typedefs/config-layer'
import { REPOSITORY_FILE_KEYS } from '../typedefs/config-layer'

export const aLayer = (
  name: TLayerName,
  document: TTomlDocument,
): TConfigLayer => ({
  name,
  promptRoot: `/${name}`,
  document,
  files: [
    {
      layer: name,
      path: `/${name}/pi-crust.toml`,
      allowedKeys: REPOSITORY_FILE_KEYS,
      document,
    },
  ],
})
