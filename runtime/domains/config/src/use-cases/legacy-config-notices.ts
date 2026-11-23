import type { TLegacyFindings } from '../typedefs/config-layer'

export const legacyConfigNotices = (
  found: TLegacyFindings,
  _where: Readonly<{ repositoryPath: string; machineDirectory: string }>,
): readonly string[] => [
  ...(found.repositoryFiles.length === 0
    ? []
    : [
        `${found.repositoryDirectory}: ${found.repositoryFiles.join(', ')} not read; migrate by hand to pi-crust.toml.${found.repositoryFiles.includes('crust.observe.yaml') ? ' The trace UI still reads themes and default_theme from crust.observe.yaml.' : ''}`,
      ]),
  ...(found.machineFile === ''
    ? []
    : [
        `${found.machineFile}: not read; migrate by hand to crust.config.toml in the same directory.`,
      ]),
  ...(found.machineVariableFile === ''
    ? []
    : [
        `CRUST_MACHINE_CONFIG=${found.machineVariableFile}: not read; this variable now names a directory holding the three TOML files.`,
      ]),
]
