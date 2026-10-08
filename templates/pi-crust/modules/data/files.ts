/** Filesystem plumbing. Everything that touches the disk goes through here. */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

export const ensureDir = (path: string): string => {
  mkdirSync(path, { recursive: true })
  return path
}

export const ensureParentDir = (path: string): string => {
  ensureDir(dirname(path))
  return path
}

export const readText = (path: string): string => readFileSync(path, 'utf8')

export const writeText = (path: string, content: string): string => {
  ensureParentDir(path)
  writeFileSync(path, content, 'utf8')
  return path
}

export const appendText = (path: string, content: string): void => {
  ensureParentDir(path)
  appendFileSync(path, content, 'utf8')
}

export const fileExists = (path: string): boolean => existsSync(path)

export const isFile = (path: string): boolean =>
  existsSync(path) && statSync(path).isFile()

export const byteSize = (path: string): number => statSync(path).size

/** Human size, used as gate evidence: "454B", "2.1KB". */
export const humanSize = (path: string): string => {
  const bytes = byteSize(path)
  return bytes < 1024 ? `${bytes}B` : `${(bytes / 1024).toFixed(1)}KB`
}
