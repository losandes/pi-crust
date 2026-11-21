import { expect, test } from 'bun:test'
import { harnessProject } from './harness-project'

const paths = (hostModules: string): Record<string, readonly string[]> => {
  const project = harnessProject(hostModules) as {
    compilerOptions: { paths: Record<string, readonly string[]> }
  }
  return project.compilerOptions.paths
}

test(
  [
    'given use-cases/harness-project::harnessProject',
    "when it is given a host's module directory",
    'it should map every specifier the extensions import onto that host',
  ].join(', '),
  () => {
    expect(paths('/pi/releases/1.1.0/node_modules')).toEqual({
      '@earendil-works/*': [
        '/pi/releases/1.1.0/node_modules/@earendil-works/*',
      ],
      typebox: ['/pi/releases/1.1.0/node_modules/typebox'],
      'typebox/*': ['/pi/releases/1.1.0/node_modules/typebox/*'],
    })
  },
)

test(
  [
    'given use-cases/harness-project::harnessProject',
    'when a different host is named',
    'it should follow that one, because the pinned version is the thing being avoided',
  ].join(', '),
  () => {
    expect(paths('/elsewhere/node_modules').typebox).toEqual([
      '/elsewhere/node_modules/typebox',
    ])
  },
)

test(
  [
    'given use-cases/harness-project::harnessProject',
    'when the project is written out',
    'it should extend the sibling tsconfig and check only the harness directory',
  ].join(', '),
  () => {
    const project = harnessProject('/pi/node_modules')

    // Relative, because the file is generated beside the config it extends:
    // `types: ["bun"]` resolves from the file that declares it.
    expect(project.extends).toEqual('./tsconfig.json')
    expect(project.include).toEqual(['extensions'])
  },
)

test(
  [
    'given use-cases/harness-project::harnessProject',
    'when the project is written out',
    'it should turn composite off, so a file it reaches outside the include is not reported as unlisted',
  ].join(', '),
  () => {
    const project = harnessProject('/pi/node_modules') as {
      compilerOptions: { composite: boolean }
    }

    // Inherited as true from runtime/tsconfig.json, where it exists so the
    // repository root can reference that project. Here it only produces
    // TS6307 for every `domains/` and `lib/` file the extensions import.
    expect(project.compilerOptions.composite).toEqual(false)
  },
)
