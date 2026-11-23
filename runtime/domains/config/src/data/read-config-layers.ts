import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import {
  safeParseSettlement,
  type TSettlement,
} from '../../../../../lib/typedefs'
import { DEFAULT_CONFIG_PATH } from '../../../../lib/contracts'
import {
  machineConfigDirFromEnv,
  packageConfigDirFromEnv,
  type TEnv,
} from '../../../../lib/system'
import {
  LAYER_FILE_KEYS,
  REPOSITORY_FILE_KEYS,
  type TConfigLayer,
  type TLayerFile,
  type TLayerName,
  type TReadLayers,
} from '../typedefs/config-layer'

const regularFile = (path: string): boolean =>
  existsSync(path) && statSync(path).isFile()

const readFile = (
  layer: TLayerName,
  path: string,
  allowedKeys: readonly string[],
): TLayerFile => {
  const parsed = safeParseSettlement(() =>
    z
      .record(z.string(), z.unknown())
      .parse(Bun.TOML.parse(readFileSync(path, 'utf8'))),
  )
  if (parsed.status === 'error')
    throw new Error(`${path}: ${parsed.error.message}`)
  return { layer, path, allowedKeys, document: parsed.data }
}

const directoryLayer = (
  name: 'package' | 'machine',
  directory: string,
): TConfigLayer => {
  const files = Object.entries(LAYER_FILE_KEYS).flatMap(([file, keys]) => {
    const path = join(directory, file)
    return regularFile(path) ? [readFile(name, path, keys)] : []
  })
  return {
    name,
    promptRoot: dirname(directory),
    files,
    document: Object.assign({}, ...files.map((file) => file.document)),
  }
}

/** Filesystem and TOML exceptions are settled at this input boundary. */
export const readConfigLayers = (
  repositoryPath: string,
  env: TEnv,
): TSettlement<TReadLayers> =>
  safeParseSettlement<TReadLayers>(() => {
    const path = resolve(repositoryPath)
    if (!existsSync(path) && repositoryPath !== DEFAULT_CONFIG_PATH)
      throw new Error(`${path}: configuration file not found`)
    const packageDirectory = resolve(
      packageConfigDirFromEnv(env) ??
        join(import.meta.dir, '../../../../config'),
    )
    const machineDirectory = resolve(
      machineConfigDirFromEnv(env) ??
        join(env.HOME ?? homedir(), '.pi-crust/config'),
    )
    const files = existsSync(path)
      ? [readFile('repository', path, REPOSITORY_FILE_KEYS)]
      : []
    const repositoryDirectory = join(dirname(path), '.pi-crust/config')
    const repositoryFiles =
      existsSync(repositoryDirectory) &&
      statSync(repositoryDirectory).isDirectory()
        ? readdirSync(repositoryDirectory)
            .filter(
              (name) =>
                /^crust\..*\.ya?ml$/.test(name) &&
                !name.endsWith('.example.yaml') &&
                regularFile(join(repositoryDirectory, name)),
            )
            .toSorted()
        : []
    return {
      layers: [
        directoryLayer('package', packageDirectory),
        directoryLayer('machine', machineDirectory),
        {
          name: 'repository',
          promptRoot: dirname(path),
          files,
          document: files[0]?.document ?? {},
        },
      ],
      machineDirectory,
      legacy: {
        repositoryDirectory,
        repositoryFiles,
        machineFile:
          ['yaml', 'yml']
            .map((extension) =>
              join(machineDirectory, `crust.config.${extension}`),
            )
            .find(regularFile) ?? '',
        machineVariableFile:
          machineConfigDirFromEnv(env) !== undefined &&
          regularFile(machineDirectory)
            ? machineDirectory
            : '',
      },
    }
  })
