import type { TTomlDocument } from '../typedefs/config-layer'

export const isTable = (value: unknown): value is TTomlDocument =>
  Object.prototype.toString.call(value) === '[object Object]'

export const tableOf = (value: unknown): TTomlDocument =>
  isTable(value) ? value : {}

/** Tables merge recursively; every other value, including an array, replaces. */
export const mergeLayers = (
  earlier: TTomlDocument,
  later: TTomlDocument,
): TTomlDocument =>
  Object.fromEntries(
    [...new Set([...Object.keys(earlier), ...Object.keys(later)])].map(
      (key) => [
        key,
        Object.hasOwn(later, key)
          ? isTable(earlier[key]) && isTable(later[key])
            ? mergeLayers(earlier[key], later[key])
            : later[key]
          : earlier[key],
      ],
    ),
  )
