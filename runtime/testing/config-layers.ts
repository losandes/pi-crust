import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Disposable on-disk TOML layers shared by configuration, catalogue and planning tests. */
export const layersFixture = (files: Readonly<Record<string, string>> = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'crust-toml-'))
  const write = (name: string, text: string): string => {
    const path = join(root, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
    return path
  }
  write(
    'package/crust.activities.toml',
    '[planners.operator]\nwrites = []\n[planners.triage]\nwrites = []\n[terminal.gh-pull-request]\nwrites = []\n',
  )
  const repositoryPath = write('repository/pi-crust.toml', '# empty\n')
  Object.entries(files).forEach(([name, text]) => {
    write(name, text)
  })
  return {
    root,
    write,
    repositoryPath,
    env: {
      CRUST_PACKAGE_CONFIG: join(root, 'package'),
      CRUST_MACHINE_CONFIG: join(root, 'machine'),
      HOME: join(root, 'home'),
    },
    [Symbol.dispose]: () => rmSync(root, { recursive: true, force: true }),
  }
}
