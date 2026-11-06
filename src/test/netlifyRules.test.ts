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
    expect(lines).toContain('/assets/*')
    expect(lines).toContain('Cache-Control: public, max-age=31536000, immutable')
    // Matching Cache-Control headers combine on Netlify. A broad /* no-cache
    // would negate immutable caching, regardless of where the asset rule is.
    expect(lines).not.toContain('/*')
    expect(cacheRulesFor('/assets/index-abc.js')).toEqual(['public, max-age=31536000, immutable'])
    expect(cacheRulesFor('/assets/decoder-abc.wasm')).toEqual(['public, max-age=31536000, immutable'])
  })

  it('revalidates HTML on every SPA route and never stores the version manifest', () => {
    const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8')
    const paths = [...app.matchAll(/<Route path="([^"*]+)"/g)].map((match) => match[1])
    for (const path of ['/', '/index.html', ...paths, ...paths.filter((path) => path !== '/').map((path) => `${path}/`)]) {
      expect(cacheRulesFor(path), path).toContain('no-cache')
      expect(cacheRulesFor(path), path).not.toContain('public, max-age=31536000, immutable')
    }
    expect(cacheRulesFor('/version.json')).toContain('no-store')
  })
})

// Netlify placeholders match a single segment, while * spans the remainder.
function cacheRulesFor(path: string): string[] {
  let matches = false
  const values: string[] = []
  for (const line of rules('_headers')) {
    if (line.startsWith('/')) {
      const pattern = line.replace(/\./g, '\\.').replace(/:[a-z]+/g, '[^/]+').replace(/\*/g, '.*')
      matches = new RegExp(`^${pattern}$`).test(path)
    } else if (matches && line.startsWith('Cache-Control: ')) {
      values.push(line.slice('Cache-Control: '.length))
    }
  }
  return values
}
