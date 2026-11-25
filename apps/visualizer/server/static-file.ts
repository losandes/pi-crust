import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html;charset=utf-8',
  '.js': 'text/javascript;charset=utf-8',
  '.css': 'text/css;charset=utf-8',
  '.json': 'application/json;charset=utf-8',
  '.map': 'application/json;charset=utf-8',
  '.txt': 'text/plain;charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}
export const contentTypeOf = (path: string): string =>
  CONTENT_TYPES[extname(path)] ?? 'application/octet-stream'
export const fileResponse = (
  path: string,
  headers: Readonly<Record<string, string>> = {},
): Response => {
  const result = new Headers({ 'content-type': contentTypeOf(path) })
  Object.entries(headers).forEach(([name, value]) => {
    result.set(name, value)
  })
  return new Response(readFileSync(path), { headers: result })
}
