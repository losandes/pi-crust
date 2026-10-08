import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_ROLES, agentRole, isAgentRole, paletteColor } from './palette'

const TOKENS = readFileSync(
  join(import.meta.dir, '..', 'theme', 'tokens.css'),
  'utf8',
)

const THEMES = ['dark', 'light', 'high-contrast'] as const

/** The block of declarations belonging to one theme. */
const themeBlock = (theme: string): string => {
  const marker =
    theme === 'dark' ? "[data-theme='dark'] {" : `[data-theme='${theme}'] {`
  const start = TOKENS.indexOf(marker)
  return start === -1 ? '' : TOKENS.slice(start, TOKENS.indexOf('}', start))
}

test(
  [
    'given lib/palette::AGENT_ROLES',
    'when a role is offered to an agent',
    'it should have a value in EVERY theme, or that theme renders nothing',
  ].join(' '),
  () => {
    // given
    const blocks = THEMES.map((theme) => [theme, themeBlock(theme)] as const)

    // when
    const missing = blocks.flatMap(([theme, block]) =>
      AGENT_ROLES.filter((role) => !block.includes(`--${role}-rgb:`)).map(
        (role) => `${theme}: --${role}-rgb`,
      ),
    )

    // then
    expect(blocks.every(([, block]) => block !== '')).toBe(true)
    expect(missing).toEqual([])
  },
)

test(
  [
    'given lib/palette::paletteColor',
    'when the agent named a role',
    'it should resolve to the theme token, so a theme switch re-colours it',
  ].join(' '),
  () => {
    // given
    const role = 'amber'

    // when
    const full = paletteColor(role)
    const faded = paletteColor(role, 0.25)

    // then
    expect(full).toBe('rgb(var(--amber-rgb))')
    expect(faded).toBe('rgb(var(--amber-rgb) / 0.25)')
  },
)

test(
  [
    'given lib/palette::paletteColor',
    'when a roster still carries a hex, as older ones do',
    'it should honour it verbatim rather than drop the lane colour',
  ].join(' '),
  () => {
    // given
    const hex = '#38bdf8'

    // when
    const full = paletteColor(hex)
    const faded = paletteColor(hex, 0.5)

    // then
    expect(full).toBe('rgb(56 189 248)')
    expect(faded).toBe('rgb(56 189 248 / 0.5)')
  },
)

test(
  [
    'given lib/palette::paletteColor',
    'when the value is neither a role nor a colour',
    'it should be visibly transparent rather than guess at a colour',
  ].join(' '),
  () => {
    // given
    const nonsense = 'burnt sienna'

    // when
    const resolved = paletteColor(nonsense)

    // then
    expect(resolved).toBe('transparent')
  },
)

test(
  [
    'given lib/palette::agentRole',
    'when an agent configured nothing',
    'it should take a role by position, so adjacent lanes always differ',
  ].join(' '),
  () => {
    // given
    const positions = [0, 1, 2]

    // when
    const roles = positions.map((index) => agentRole(undefined, index))

    // then
    expect(new Set(roles).size).toBe(3)
    expect(roles.every(isAgentRole)).toBe(true)
  },
)

test(
  [
    'given lib/palette::agentRole',
    'when an agent configured a role',
    'it should keep it rather than override it by position',
  ].join(' '),
  () => {
    // given
    const configured = 'teal'

    // when
    const role = agentRole(configured, 0)

    // then
    expect(role).toBe('teal')
  },
)

test(
  [
    'given lib/palette::AGENT_ROLES',
    'when the failure colour is considered for an agent',
    'it should be absent, because red means a failed phase everywhere else',
  ].join(' '),
  () => {
    // given
    const roles: readonly string[] = AGENT_ROLES

    // when
    const hasRed = roles.includes('red')

    // then
    expect(hasRed).toBe(false)
  },
)

/** `--name-rgb: R G B;` out of a theme block, as three numbers. */
const channels = (block: string, name: string): readonly number[] => {
  const found = new RegExp(`--${name}-rgb:\\s*([0-9]+) ([0-9]+) ([0-9]+)`).exec(
    block,
  )
  return found === null
    ? []
    : [Number(found[1]), Number(found[2]), Number(found[3])]
}

/** WCAG relative luminance, so the ratio below is the real one. */
const luminance = (rgb: readonly number[]): number => {
  const linear = rgb.map((value) => {
    const channel = value / 255
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  })
  return (
    0.2126 * (linear[0] ?? 0) +
    0.7152 * (linear[1] ?? 0) +
    0.0722 * (linear[2] ?? 0)
  )
}

const contrast = (a: readonly number[], b: readonly number[]): number => {
  const [high, low] = [luminance(a), luminance(b)].toSorted((x, y) => y - x)
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05)
}

test(
  [
    'given the theme tokens',
    'when the waiting hue is read in every theme',
    'it should be legible as TEXT on that theme own panel',
  ].join(' '),
  () => {
    // given — one hue restated per theme, because the value that reads at
    // 5.27:1 on near-black reads at 3.58:1 on white and stops being text
    const floors: Readonly<Record<string, number>> = {
      dark: 4.5,
      light: 4.5,
      // the theme that exists for contrast holds itself to the higher bar
      'high-contrast': 7,
    }

    // when
    const measured = THEMES.map((theme) => {
      const block = themeBlock(theme)
      return {
        theme,
        ratio: contrast(
          channels(block, 'hotpink'),
          channels(block, 'panel'),
        ),
      }
    })

    // then
    const failures = measured.filter(
      (row) => row.ratio < (floors[row.theme] ?? 4.5),
    )
    expect(failures).toEqual([])
  },
)

test(
  [
    'given the theme tokens',
    'when the waiting hue is compared with the pink AGENT role',
    'it should be a different colour in every theme',
  ].join(' '),
  () => {
    // given — an agent lane may be pink, and the one state that cannot be
    // mistaken for anything else must not share a colour with a lane label
    const blocks = THEMES.map((theme) => themeBlock(theme))

    // when
    const clashes = blocks.filter(
      (block) =>
        channels(block, 'hotpink').join(' ') === channels(block, 'pink').join(' '),
    )

    // then
    expect(clashes).toEqual([])
  },
)

test(
  [
    'given the theme layer',
    'when a stylesheet names a custom property',
    'it should be one the themes actually define',
  ].join(', '),
  () => {
    // given — an invented token is SILENT. `var(--surface-raised)` is not
    // an error, it is a declaration the browser drops, so a card simply has
    // no background and nothing says why. Five of them shipped before this
    // test existed — --surface-raised, --text-dim, --surface-sunken,
    // --font-mono and --fg — 27 dead declarations across ten stylesheets.
    const dir = join(import.meta.dir, '..')
    const sheets = [
      ...new Bun.Glob('**/*.css').scanSync({ cwd: dir, absolute: true }),
    ]
    const defined = new Set(
      [...TOKENS.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map(
        (match) => match[1] ?? '',
      ),
    )

    // when — every property referenced anywhere, minus the ones a sheet
    // defines for itself
    const used = sheets.flatMap((file) => {
      const css = readFileSync(file, 'utf8')
      const local = new Set(
        [...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map(
          (match) => match[1] ?? '',
        ),
      )
      /*
       * Only references with no fallback. `var(--radius-sm, 4px)` names a
       * token the theme does not define and says what to do about it, which
       * is a deliberate default rather than a mistake — flagging those would
       * make this test noise, and a noisy test gets deleted.
       */
      return [...css.matchAll(/var\((--[a-z0-9-]+)\s*(,?)/g)]
        .filter(
          (match) =>
            match[2] !== ',' &&
            !(defined.has(match[1] ?? '') || local.has(match[1] ?? '')),
        )
        .map((match) => `${file.split('/').at(-1)}: ${match[1] ?? ''}`)
    })

    // then
    expect(sheets.length).toBeGreaterThan(5)
    expect([...new Set(used)]).toEqual([])
  },
)

test(
  [
    'given the theme layer',
    'when a table stripes its alternating rows',
    'it should sit in the band between invisible and banded',
  ].join(', '),
  () => {
    // given — a floor alone is the wrong test, and both failures happened:
    // the raised panel at 35% alpha measured 1.016:1 and was invisible, the
    // correction measured 1.48:1 and read as bands competing with the text.
    // A stripe is a reading aid, so it is wrong in BOTH directions.
    /*
     * Both surfaces a table sits on in each theme: the modal's panel and the
     * raised card behind the run's prompt. The stripe is judged on the one
     * it resembles MOST, because that is where it comes closest to
     * disappearing — measuring only the darker of the two flatters it.
     */
    const surfaces: Readonly<Record<string, readonly (readonly number[])[]>> = {
      dark: [
        [16, 20, 31],
        [19, 26, 38],
      ],
      light: [
        [255, 255, 255],
        [241, 245, 250],
      ],
      'high-contrast': [
        [0, 0, 0],
        [20, 20, 20],
      ],
    }

    // when
    const measured = THEMES.map((theme) => {
      const match = /--zebra-rgb:\s*([0-9]+)\s+([0-9]+)\s+([0-9]+)/.exec(
        themeBlock(theme),
      )
      const stripe = (match ?? []).slice(1, 4).map(Number)
      const against = surfaces[theme] ?? []
      return {
        theme,
        ratio:
          stripe.length === 3
            ? Math.min(...against.map((surface) => contrast(stripe, surface)))
            : 0,
      }
    })

    // then — low by text standards on purpose: the words sitting on the
    // stripe are the thing being read, not the stripe
    expect(
      measured.filter((row) => row.ratio < 1.12 || row.ratio > 1.3),
    ).toEqual([])
  },
)

test(
  [
    'given the theme layer',
    'when a table header sits above striped rows',
    'it should never be mistaken for one of the stripes',
  ].join(', '),
  () => {
    // given — the header used to borrow the raised-card colour, which on the
    // light theme made it LIGHTER than the stripes beneath it: the heaviest
    // row on the page read as the faintest. The literal fix, swapping the
    // two, would have returned the stripe to 1.00:1 and made it vanish, so
    // the invariant is the relationship rather than either value.
    const rgbOf = (block: string, token: string): readonly number[] => {
      const match = new RegExp(`${token}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`).exec(block)
      return (match ?? []).slice(1, 4).map(Number)
    }

    // when
    const measured = THEMES.map((theme) => {
      const block = themeBlock(theme)
      const head = rgbOf(block, '--table-head-rgb')
      const stripe = rgbOf(block, '--zebra-rgb')
      return {
        theme,
        apart: head.length === 3 && stripe.length === 3 ? contrast(head, stripe) : 0,
        // Negative means the header is darker, which is what a light page
        // needs for the header to read as the heaviest band.
        headerIsDarker: luminance(head) < luminance(stripe),
      }
    })

    // then — distinguishable everywhere, and on the light theme the header
    // is the darker of the two
    expect(measured.filter((row) => row.apart < 1.1)).toEqual([])
    expect(measured.find((row) => row.theme === 'light')?.headerIsDarker).toBe(
      true,
    )
  },
)
