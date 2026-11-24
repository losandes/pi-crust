import { expect, test } from 'bun:test'
import {
  FRESH_INSTALL_FILES,
  installFaults,
  type TFreshInstall,
} from './install-faults'

const TEMPLATE =
  '# [tasks.verify]\n# when = [{ on = "change", skip = ["diagnose"] }]\n# run = "<command>"\n'
const valid = (): TFreshInstall => ({
  files: FRESH_INSTALL_FILES.toReversed(),
  installed: TEMPLATE,
  template: TEMPLATE,
})

for (const [name, transform, message] of [
  [
    'extra file',
    (value: TFreshInstall) => ({
      ...value,
      files: [...value.files, '.pi-crust/config/extra'],
    }),
    'fresh install files differ',
  ],
  [
    'missing file',
    (value: TFreshInstall) => ({ ...value, files: value.files.slice(1) }),
    'fresh install files differ',
  ],
  [
    'changed bytes',
    (value: TFreshInstall) => ({
      ...value,
      installed: `${value.installed}# changed\n`,
    }),
    'differs from templates',
  ],
  [
    'parse failure',
    (value: TFreshInstall) => ({ ...value, installed: '[broken' }),
    'not valid TOML',
  ],
  [
    'active settings',
    (value: TFreshInstall) => ({
      ...value,
      installed: `${value.installed}poll_ms = 250\n`,
    }),
    'must parse to an empty document',
  ],
  [
    'no task header',
    (value: TFreshInstall) => ({
      ...value,
      installed: value.installed.replace('# [tasks.verify]', '# task'),
    }),
    'no commented example task',
  ],
  [
    'no trigger',
    (value: TFreshInstall) => ({
      ...value,
      installed: value.installed.replace('on = "change"', 'before = "build"'),
    }),
    'no commented change or deliver',
  ],
  [
    'empty skip',
    (value: TFreshInstall) => ({
      ...value,
      installed: value.installed.replace('skip = ["diagnose"]', 'skip = []'),
    }),
    'no commented non-empty skip',
  ],
] as const) {
  test(
    [
      `given @SC24 a fresh install with ${name}`,
      'when install invariants are checked',
      `it should report ${message}`,
    ].join(', '),
    () => {
      // given
      const install = transform(valid())
      // when
      const actual = installFaults(install)
      // then
      expect(actual.some((fault) => fault.includes(message))).toBe(true)
    },
  )
}

for (const installed of [
  TEMPLATE,
  '# [tasks.verify]\n# when = [{ on = "deliver" }]\n# skip = ["test-tdd"]\n',
]) {
  test(
    [
      'given an empty TOML file with commented task examples',
      'when checked against the exact fresh-install file set',
      'it should accept it independent of file traversal order',
    ].join(', '),
    () => {
      // given
      const install = { ...valid(), installed, template: installed }
      // when
      const actual = installFaults(install)
      // then
      expect(actual).toEqual([])
    },
  )
}
