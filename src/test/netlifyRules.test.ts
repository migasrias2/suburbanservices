import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** The Netlify files in public/ that Vite copies into dist/ (review L5). */
const publicFile = (name: string) => resolve(__dirname, '../../public', name)
const rules = (name: string) =>
  readFileSync(publicFile(name), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))

describe('Netlify rules', () => {
  it('a missing /assets/ file is a 404, not index.html (checked before the SPA fallback)', () => {
    const lines = rules('_redirects')
    const assets = lines.findIndex((line) => /^\/assets\/\*\s+\/404\.html\s+404$/.test(line))
    const spa = lines.findIndex((line) => /^\/\*\s+\/index\.html\s+200$/.test(line))
    expect(assets).toBeGreaterThanOrEqual(0)
    expect(spa).toBeGreaterThan(assets)
    expect(existsSync(publicFile('404.html'))).toBe(true)
  })

  it('only /assets/ is cached for a year', () => {
    const lines = rules('_headers')
    expect(lines).toEqual(['/assets/*', 'Cache-Control: public, max-age=31536000, immutable'])
  })
})
