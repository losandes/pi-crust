import { safeParseSettlement } from '../lib/typedefs'

export const FRESH_INSTALL_FILES: readonly string[] = [
  '.env.pi-crust.example',
  '.gitignore',
  'pi-crust.toml',
]
export type TFreshInstall = Readonly<{
  files: readonly string[]
  installed: string
  template: string
}>

/** Pure checks of the fresh-install file set and inactive task examples. */
export const installFaults = ({
  files,
  installed,
  template,
}: TFreshInstall): readonly string[] => {
  const parsed = safeParseSettlement(() => Bun.TOML.parse(installed))
  return [
    ...(JSON.stringify(files.toSorted()) === JSON.stringify(FRESH_INSTALL_FILES)
      ? []
      : [
          `fresh install files differ: expected ${FRESH_INSTALL_FILES.join(', ')}; found ${files.toSorted().join(', ')}`,
        ]),
    ...(installed === template
      ? []
      : ['pi-crust.toml differs from templates/pi-crust.toml']),
    ...(parsed.status === 'error'
      ? [`pi-crust.toml is not valid TOML: ${parsed.error.message}`]
      : Object.keys(parsed.data).length === 0
        ? []
        : [
            'pi-crust.toml must parse to an empty document; tasks must be inactive',
          ]),
    ...(/^# \[tasks\.[A-Za-z][A-Za-z0-9_.:-]*\]$/m.test(installed)
      ? []
      : ['pi-crust.toml has no commented example task table']),
    ...(/^# when = \[\{ on = "(?:change|deliver)"/m.test(installed)
      ? []
      : ['pi-crust.toml has no commented change or deliver trigger']),
    ...(/^# when = .*skip = \[\s*"[^"\n]+"/m.test(installed) ||
    /^# skip = \[\s*"[^"\n]+"/m.test(installed)
      ? []
      : ['pi-crust.toml has no commented non-empty skip list']),
  ]
}
