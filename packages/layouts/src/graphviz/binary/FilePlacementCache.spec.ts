import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'vitest'
import { FilePlacementCache } from './FilePlacementCache'

const value = { centers: [[10, 20] as const], polylines: [[[10, 20] as const, [30, 40] as const]] }
const directories: string[] = []
const directory = () => {
  const dir = mkdtempSync(join(tmpdir(), 'likec4-surround-cache-'))
  directories.push(dir)
  return dir
}
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })))

describe('persistent surround placement cache', () => {
  it('reuses geometry through a new instance without sharing mutable values', ({ expect }) => {
    const dir = directory()
    const first = new FilePlacementCache(dir)
    first.set('graph and search inputs', value)
    const second = new FilePlacementCache(dir)
    expect(second.get('graph and search inputs')).toEqual(value)
    second.get('graph and search inputs')!.centers[0] = [300, 400]
    expect(first.get('graph and search inputs')).toEqual(value)
    expect(second.get('changed graph or search inputs')).toBeUndefined()
  })

  it('ignores corrupt, mismatched, and invalid geometry entries', ({ expect }) => {
    const dir = directory()
    const cache = new FilePlacementCache(dir)
    cache.set('key', value)
    const file = join(dir, readdirSync(dir)[0]!)
    const valid = readFileSync(file, 'utf8')
    for (
      const data of [
        '{broken',
        JSON.stringify({ key: 'other', placement: value }),
        JSON.stringify({ key: 'key', placement: { centers: [[null, 1]], polylines: [] } }),
        JSON.stringify({ key: 'key', placement: { centers: [[1, 2]], polylines: [[]] } }),
      ]
    ) {
      writeFileSync(file, data)
      expect(cache.get('key')).toBeUndefined()
    }
    writeFileSync(file, valid)
    expect(cache.get('key')).toEqual(value)
  })

  it('bounds entries and file size without touching unrelated files', ({ expect }) => {
    const dir = directory()
    writeFileSync(join(dir, 'unrelated'), 'keep')
    const cache = new FilePlacementCache(dir, 2)
    for (const key of ['a', 'b', 'c']) cache.set(key, value)
    expect(cache.get('c')).toEqual(value)
    expect(readdirSync(dir).filter(name => name.endsWith('.json'))).toHaveLength(2)
    cache.set('oversized'.repeat(500_000), value)
    expect(readdirSync(dir)).toHaveLength(3)
    expect(readFileSync(join(dir, 'unrelated'), 'utf8')).toBe('keep')
    new FilePlacementCache(dir, 0).set('disabled', value)
    expect(readdirSync(dir)).toHaveLength(3)
  })

  it('treats unavailable storage as a cache miss without throwing on writes', ({ expect }) => {
    const file = join(directory(), 'file')
    writeFileSync(file, 'not a directory')
    const cache = new FilePlacementCache(file)
    expect(cache.get('key')).toBeUndefined()
    expect(() => cache.set('key', value)).not.toThrow()
  })
})
