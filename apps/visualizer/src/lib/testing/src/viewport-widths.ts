import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const theme = readFileSync(
  createRequire(import.meta.url).resolve('tailwindcss/theme.css'),
  'utf8',
)

const breakpointInPixels = (tier: string): number => {
  const rem = theme.match(
    new RegExp(`--breakpoint-${tier}:\\s*([\\d.]+)rem\\s*;`),
  )?.[1]
  if (rem === undefined) {
    throw new Error(`Tailwind is missing its default ${tier} breakpoint in rem`)
  }
  // Media-query rem units use the browser's initial font size, not body styles.
  return Number(rem) * 16
}

export const phoneViewport = { width: 320, height: 568 } as const

/** Browser-test widths: a small phone, then each default Tailwind tier. */
export const viewportWidths = {
  base: phoneViewport.width,
  sm: breakpointInPixels('sm'),
  md: breakpointInPixels('md'),
  lg: breakpointInPixels('lg'),
  xl: breakpointInPixels('xl'),
  '2xl': breakpointInPixels('2xl'),
} as const

export type TViewportTier = keyof typeof viewportWidths
