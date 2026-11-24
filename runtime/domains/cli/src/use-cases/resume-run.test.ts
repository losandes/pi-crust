import { expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import { parseCli } from './parse-cli'
import {
  INVOCATION_FILENAME,
  installedEntry,
  recordedInvocation,
  resumeArgv,
  resumeRecordedRun,
  sessionDirOf,
} from './resume-run'

const sessionWith = (record: unknown): string => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-resume-'))
  writeFileSync(join(dir, INVOCATION_FILENAME), JSON.stringify(record))
  return dir
}

test(
  [
    'given use-cases/resume-run::resumeArgv',
    'when the run was launched with flags',
    'it should carry every one of them into the resumed command',
  ].join(', '),
  () => {
    // given — `--approve-after` exists only in argv, so a resumer that drops
    // it silently removes the gate the developer asked for
    const argv = [
      'bun',
      '/pkg/runtime/commands/run.ts',
      'specs/stats.md',
      '--approve-after',
      'plan',
    ]

    // when
    const actual = resumeArgv(argv, '9afffac5')

    // then
    expect(actual).toEqual([
      '/pkg/runtime/commands/run.ts',
      'specs/stats.md',
      '--approve-after',
      'plan',
      '--run-id',
      '9afffac5',
      '--resume',
    ])
  },
)

test(
  [
    'given use-cases/resume-run::resumeArgv',
    'when the run was launched with short flags',
    'it should canonicalise to long names with no duplicated flag',
  ].join(', '),
  () => {
    // given — the strip filter only matches `--run-id` and `--resume` by
    // their long names, so a short-launched run would otherwise carry both
    // the old short flag and the newly appended long one
    const argv = ['bun', '/x/compose.ts', 'p', '-l', 'sdlc', '-id', 'old', '-r']

    // when
    const actual = resumeArgv(argv, 'new')

    // then
    expect(actual).toEqual([
      '/x/compose.ts',
      'p',
      '--lifecycle',
      'sdlc',
      '--run-id',
      'new',
      '--resume',
    ])
  },
)

test(
  [
    'given use-cases/resume-run::resumeArgv',
    'when the run being resumed was itself a resumed run',
    'it should not stack a second --run-id or --resume',
  ].join(', '),
  () => {
    // given — the second gate of a chain picked up once already
    const argv = [
      'bun',
      '/pkg/runtime/commands/run.ts',
      'spec.md',
      '--run-id',
      '9afffac5',
      '--resume',
    ]

    // when
    const actual = resumeArgv(argv, '9afffac5')

    // then — two commands that do the same thing should look the same
    expect(actual).toEqual([
      '/pkg/runtime/commands/run.ts',
      'spec.md',
      '--run-id',
      '9afffac5',
      '--resume',
    ])
  },
)

for (const flags of [
  ['--model', 'build=openai/gpt-5@high,code-review=@xhigh'],
  ['-m', 'build=openai/gpt-5@high,code-review=@xhigh'],
  ['--model=build=openai/gpt-5@high,code-review=@xhigh'],
  ['-m=build=openai/gpt-5@high,code-review=@xhigh'],
]) {
  test(
    [
      'given use-cases/resume-run::resumeArgv',
      `when a run was launched with ${flags[0]}`,
      'it should retain the model overrides, normalise the flag, and parse on resume',
    ].join(', '),
    () => {
      // given
      const argv = [
        'bun',
        '/x/compose.ts',
        'build it',
        '-l',
        'deliver',
        ...flags,
      ]

      // when
      const actual = resumeArgv(argv, '9afffac5')
      const parsed = parseCli(actual.slice(1))

      // then
      expect(actual).toEqual([
        '/x/compose.ts',
        'build it',
        '--lifecycle',
        'deliver',
        ...(flags.length === 1
          ? ['--model=build=openai/gpt-5@high,code-review=@xhigh']
          : ['--model', 'build=openai/gpt-5@high,code-review=@xhigh']),
        '--run-id',
        '9afffac5',
        '--resume',
      ])
      expect(parsed.models).toBe('build=openai/gpt-5@high,code-review=@xhigh')
      expect(parsed.resume).toBe(true)
    },
  )
}

test(
  [
    'given use-cases/resume-run::recordedInvocation',
    'when a prompt was given inline and contains spaces',
    'it should survive as ONE argument',
  ].join(', '),
  () => {
    // given — this is why argv is recorded as a list rather than reconstructed
    // from the space-joined command in the processes table
    const dir = sessionWith({
      argv: [
        'bun',
        '/pkg/runtime/commands/triage.ts',
        'name the directories. change nothing.',
      ],
      cwd: '/app',
    })

    // when
    const actual = recordedInvocation(dir)

    // then
    expect(actual?.argv[2]).toBe('name the directories. change nothing.')
    rmSync(dir, { recursive: true, force: true })
  },
)

test(
  [
    'given use-cases/resume-run::recordedInvocation',
    'when the run never recorded one',
    'it should say so rather than guessing a command',
  ].join(', '),
  () => {
    // given — a session from before this existed
    const dir = mkdtempSync(join(tmpdir(), 'crust-resume-'))

    // when
    const actual = recordedInvocation(dir)

    // then — a guessed command drops flags, and a wrong resume costs money
    expect(actual).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  },
)

test(
  [
    'given use-cases/resume-run::resumeRecordedRun',
    'when it attaches',
    'it hands back the exit code of the run it resumed',
  ].join(' '),
  async () => {
    // given
    const dir = sessionWith({
      argv: ['bun', '-e', 'process.exit(7)'],
      cwd: process.cwd(),
    })

    // when
    const resumed = resumeRecordedRun(dir, 'attached')

    // then
    expect(resumed.started).toBe(true)
    expect(await resumed.finished).toBe(7)
    rmSync(dir, { recursive: true, force: true })
  },
)

test(
  [
    'given use-cases/resume-run::resumeRecordedRun',
    'when it detaches',
    'it reports started with nothing to wait on, so a caller cannot block',
  ].join(' '),
  () => {
    // given
    const dir = sessionWith({
      argv: ['bun', '-e', ''],
      cwd: process.cwd(),
    })

    // when
    const resumed = resumeRecordedRun(dir, 'detached')

    // then
    expect(resumed.started).toBe(true)
    expect(resumed.finished).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  },
)

test(
  [
    'given use-cases/resume-run::resumeRecordedRun',
    'when the session never recorded how it was invoked',
    'it refuses rather than guessing a command',
  ].join(' '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-resume-'))

    // when
    const resumed = resumeRecordedRun(dir)

    // then
    expect(resumed.started).toBe(false)
    expect(resumed.finished).toBeUndefined()
    expect(resumed.reason).toContain(INVOCATION_FILENAME)
    rmSync(dir, { recursive: true, force: true })
  },
)

test(
  [
    'given report::sessionDirOf',
    'when asked where a run recorded how it was started',
    'it should resolve under sessions/<run-id>, beside the db',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      // when
      const actual = sessionDirOf('/data/crust.db', 'fbf49583')

      // then
      expect(actual).toEqual(join('/data', 'sessions', 'fbf49583'))
    } finally {
      restoreTerminal()
    }
  },
)

for (const present of [true, false]) {
  test(
    [
      'given a recorded installation A and selected installation B with entry ' +
        present,
      'when a CLI resume starts',
      'it should run only B or refuse the missing entry',
    ].join(', '),
    async () => {
      // given
      const root = realpathSync(
        mkdtempSync(join(tmpdir(), 'crust-cli-installation-')),
      )
      const runtime = join(root, 'B/runtime')
      const script = join(root, 'A/runtime/commands/run.ts')
      const entry = join(runtime, 'commands/run.ts')
      const receipt = join(root, 'receipt')
      mkdirSync(join(runtime, 'commands'), { recursive: true })
      if (present)
        writeFileSync(
          entry,
          `await Bun.write(${JSON.stringify(receipt)}, process.argv[1] ?? '')`,
        )
      writeFileSync(
        join(root, 'invocation.json'),
        JSON.stringify({ argv: ['bun', script, 'request'], cwd: root }),
      )
      silenceTerminal()
      try {
        // when
        const result = resumeRecordedRun(root, 'attached', runtime)
        if (result.finished) expect(await result.finished).toBe(0)
        // then
        expect(result.started).toBe(present)
        expect(installedEntry('/external/script.ts', runtime)).toBe(
          '/external/script.ts',
        )
        if (present) {
          expect(readFileSync(receipt, 'utf8')).toBe(entry)
          expect(result.command).toContain(entry)
        } else {
          expect(result.reason).toBe(
            `${script} is not an entry point of the pi-crust at ${join(root, 'B')}`,
          )
          expect(existsSync(receipt)).toBe(false)
        }
      } finally {
        restoreTerminal()
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
}
