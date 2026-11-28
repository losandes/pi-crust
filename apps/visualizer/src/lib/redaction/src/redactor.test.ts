import { expect, test } from 'bun:test'
import { highlightJson } from '@/lib/markdown'
import { createRedactor, redactFields, redactionConfigOf } from './redactor'

const base = createRedactor({ enabled: true, home: '/Users/ada' })
const redactor = base.forRun({
  repository_root: '/Users/ada/src/app',
  workspace_root: '/Users/ada/wt/feat',
})
const examples = [
  ['bun test src', 'bun test src'],
  ['/tmp/x.log', '/tmp/x.log'],
  ['/Users/ada/notes/plan.md', '~/notes/plan.md'],
  ['cd /Users/ada', 'cd ~'],
  ['/Users/ada/src/app/README.md', '<repo>/README.md'],
  ['see /Users/ada/src/app.', 'see <repo>.'],
  ['/Users/ada/src/app-wip/README.md', '~/src/app-wip/README.md'],
  ['/Users/ada/src/app.old/x', '~/src/app.old/x'],
  ['/Users/ada/wt/feat/src/x.ts', '<worktree>/src/x.ts'],
  ['/Users/adam/x', '/Users/adam/x'],
  ['bash: cat /Users/ad…', 'bash: cat ~…'],
  ['run it in /Users/a', 'run it in ~'],
  ['ls /Users/…', 'ls /Users/…'],
  ['/Users/ada/src/ap…', '<path>…'],
  ['/Users/ada/s…', '<path>…'],
  ['/Users/ada/src/ap', '~/src/ap'],
  ['cd /Users/ada/src', 'cd ~/src'],
] as const
for (const [input, expected] of examples) {
  test(
    [
      `given text ${input}`,
      'when redacting home and run roots',
      'it should preserve the readable suffix',
    ].join(', '),
    () => {
      // given
      // when
      const actual = redactor.text(input)
      // then
      expect(actual).toBe(expected)
    },
  )
}
for (const [input, expected] of [
  ['/srv/acme/app/a.ts', '<repo>/a.ts'],
  ['/srv/acme/app-wip/a.ts', '/srv/acme/app-wip/a.ts'],
  ['/srv/acme/ap…', '<path>…'],
  ['/srv/ac…', '<path>…'],
  ['/srv/acme/ap', '<path>'],
  ['/srv/acme/ap\n', '/srv/acme/ap\n'],
  ['/srv/ac', '/srv/ac'],
  ['ls /…', 'ls /…'],
] as const) {
  test(
    [
      `given outside-home text ${input}`,
      'when redacting its root',
      'it should distinguish cuts from siblings',
    ].join(', '),
    () => {
      // given
      const outside = base.forRun({ repository_root: '/srv/acme/app' })
      // when
      const actual = outside.text(input)
      // then
      expect(actual).toBe(expected)
    },
  )
}
for (const [input, expected] of [
  ['/Users/ada/src/app', '~/src/app'],
  ['/Users/ada', '~'],
  ['/srv/acme/app', '…/acme/app'],
  ['/workspace', '…workspace'],
  ['', ''],
  ['relative', 'relative'],
  ['/', '/'],
  ['/Users/ada/src/app/', '~/src/app'],
] as const) {
  test(
    [
      `given location ${input}`,
      'when formatting it for display',
      'it should hide the machine prefix',
    ].join(', '),
    () => {
      // given
      // when
      const actual = redactor.location(input)
      // then
      expect(actual).toBe(expected)
    },
  )
}

test(
  [
    'given disabled redaction',
    'when using every operation',
    'it should return the input unchanged',
  ].join(', '),
  () => {
    // given
    const disabled = createRedactor({ enabled: false, home: '/Users/ada' })
    const input = '/Users/ada/src/app/x'
    // when, then
    expect(disabled.text(input)).toBe(input)
    expect(disabled.json(input)).toBe(input)
    expect(disabled.location(input)).toBe(input)
    expect(
      disabled.forRun({ repository_root: '/Users/ada/src/app' }).text(input),
    ).toBe(input)
  },
)

test(
  [
    'given duplicate and unusable roots',
    'when redacting paths',
    'it should prefer repo and ignore invalid prefixes',
  ].join(', '),
  () => {
    // given
    const duplicate = base.forRun({
      repository_root: '/srv/app/',
      workspace_root: '/srv/app',
    })
    const invalid = createRedactor({ enabled: true, home: '/' }).forRun({
      repository_root: 'relative',
      workspace_root: '',
    })
    // when, then
    expect(duplicate.text('/srv/app/x')).toBe('<repo>/x')
    expect(invalid.text('/srv/app relative')).toBe('/srv/app relative')
    expect(invalid.json('{ "a": 1 }')).toBe('{ "a": 1 }')
    expect(invalid.location('/srv/app')).toBe('…/app')
    expect(
      base.forRun({ repository_root: '/Users/ada' }).text('/Users/ada/x'),
    ).toBe('<repo>/x')
  },
)

test(
  [
    'given nested JSON with path keys and markup',
    'when redacting and highlighting',
    'it should retain valid literal syntax-coloured JSON',
  ].join(', '),
  () => {
    // given
    const raw = JSON.stringify({
      '/Users/ada/key': [
        '/Users/ada/src/app/x.md <b>bold</b> & more',
        { count: 1, absent: null },
      ],
    })
    // when
    const actual = redactor.json(raw)
    const html = highlightJson(actual)
    // then
    expect(JSON.parse(actual)).toEqual({
      '~/key': ['<repo>/x.md <b>bold</b> & more', { count: 1, absent: null }],
    })
    expect(html).toContain('&lt;repo&gt;')
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt; &amp; more')
    expect(html).toContain('j-key')
    expect(html).toContain('j-str')
    expect(html).not.toContain('<b>')
  },
)

for (const [raw, expected] of [
  ['{ "a": "/Users/adam/x" }', '{ "a": "/Users/adam/x" }'],
  ['not JSON /Users/ada/x', 'not JSON ~/x'],
  ['"/Users/ada/x"', '"~/x"'],
  ['42', '42'],
  ['null', 'null'],
] as const) {
  test(
    [
      `given payload ${raw}`,
      'when redacting JSON',
      'it should preserve unchanged bytes or fall back to text',
    ].join(', '),
    () => {
      // given
      // when
      const actual = redactor.json(raw)
      // then
      expect(actual).toBe(expected)
    },
  )
}

test(
  [
    'given selected nullable fields',
    'when redacting a row',
    'it should change only listed string fields',
  ].join(', '),
  () => {
    // given
    const row = {
      path: '/Users/ada/x',
      raw: '{"p":"/Users/ada/x"}',
      absent: null,
      other: '/Users/ada/x',
      count: 3,
    }
    // when
    const actual = redactFields<typeof row>(redactor, {
      text: ['path', 'absent', 'count'],
      json: ['raw'],
    })(row)
    // then
    expect(actual).toEqual({ ...row, path: '~/x', raw: '{"p":"~/x"}' })
    expect(redactFields(redactor, {})(row)).toEqual(row)
  },
)

for (const [health, expected] of [
  [undefined, undefined],
  [null, undefined],
  [true, undefined],
  [{}, undefined],
  [{ redact_paths: 'false' }, undefined],
  [{ home_dir: 3 }, undefined],
  [{ redact_paths: false }, { enabled: false, home: '' }],
  [
    { redact_paths: false, home_dir: '/Users/ada' },
    { enabled: false, home: '/Users/ada' },
  ],
  [{ home_dir: '/Users/ada' }, { enabled: true, home: '/Users/ada' }],
  [
    { redact_paths: 'false', home_dir: '/Users/ada' },
    { enabled: true, home: '/Users/ada' },
  ],
] as const) {
  test(
    [
      `given health ${JSON.stringify(health)}`,
      'when validating redaction configuration',
      'it should accept only an explicit off or known home',
    ].join(', '),
    () => {
      // given
      // when
      const actual = redactionConfigOf(health)
      // then
      expect(actual).toEqual(expected)
    },
  )
}
