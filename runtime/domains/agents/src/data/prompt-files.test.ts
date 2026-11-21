import { afterEach, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import {
  render,
  resolvePromptPath,
  resolveReference,
  savePrompt,
} from './prompt-files'

const originalCwd = process.cwd()

afterEach(() => {
  process.chdir(originalCwd)
})

test(
  [
    'given data/prompt-files::resolveReference',
    'when the reference is already absolute',
    'it should return it verbatim, trusting what was written',
  ].join(', '),
  () => {
    // given
    const absolute = join(tmpdir(), 'already-absolute.md')

    // when
    const actual = resolveReference(absolute)

    // then
    expect(actual).toEqual(absolute)
  },
)

test(
  [
    'given data/prompt-files::resolveReference',
    'when the repository has its own override under .pi-crust/',
    'it should resolve to the repository copy rather than the shipped one',
  ].join(', '),
  () => {
    // given
    const repo = realpathSync(
      mkdtempSync(join(tmpdir(), 'crust-prompt-files-override-')),
    )
    mkdirSync(join(repo, '.pi-crust', 'prompts', 'plan'), {
      recursive: true,
    })
    const overridePath = join(repo, '.pi-crust', 'prompts', 'plan', 'system.md')
    writeFileSync(overridePath, 'team override\n')
    process.chdir(repo)

    // when
    const actual = resolveReference('prompts/plan/system.md')

    // then
    expect(actual).toEqual(overridePath)
  },
)

test(
  [
    'given data/prompt-files::resolveReference',
    'when the repository has no override for the reference',
    'it should fall back to the copy that ships with the package',
  ].join(', '),
  () => {
    // given — a repository with no .pi-crust/ override at all
    const repo = mkdtempSync(join(tmpdir(), 'crust-prompt-files-fallback-'))
    process.chdir(repo)

    // when
    const actual = resolveReference('prompts/plan/system.md')

    // then — not inside the empty repository's .pi-crust/
    expect(isAbsolute(actual)).toBe(true)
    expect(actual).not.toContain(join(repo, '.pi-crust'))
  },
)

test(
  [
    'given data/prompt-files::resolvePromptPath',
    'when called the same way as resolveReference',
    'it should resolve identically, because it is the same resolution',
  ].join(', '),
  () => {
    // given
    const repo = mkdtempSync(join(tmpdir(), 'crust-prompt-files-alias-'))
    process.chdir(repo)

    // when
    const viaReference = resolveReference('prompts/plan/system.md')
    const viaPromptPath = resolvePromptPath('prompts/plan/system.md')

    // then
    expect(viaPromptPath).toEqual(viaReference)
  },
)

test(
  [
    'given data/prompt-files::render',
    'when a template names a placeholder the caller supplied',
    'it should substitute every occurrence',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-prompt-files-render-'))
    const templatePath = join(dir, 'template.md')
    writeFileSync(
      templatePath,
      'Hello {{name}}, {{name}} is building {{thing}}.\n',
    )

    // when
    const actual = render(templatePath, { name: 'tester', thing: 'coverage' })

    // then
    expect(actual).toEqual('Hello tester, tester is building coverage.\n')
  },
)

test(
  [
    'given data/prompt-files::savePrompt',
    'when a rendered prompt is saved for the audit trail',
    'it should write the exact content under the given directory and name',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-prompt-files-save-'))
    const auditDir = join(dir, 'context_handoff')

    // when
    const path = savePrompt(
      auditDir,
      'build.prompt.md',
      'the exact prompt sent\n',
    )

    // then
    expect(path).toEqual(join(auditDir, 'build.prompt.md'))
    expect(readFileSync(path, 'utf8')).toEqual('the exact prompt sent\n')
  },
)
