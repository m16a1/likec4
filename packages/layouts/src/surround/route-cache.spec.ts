import { describe, it } from 'vitest'
import { RouteCache } from './route-cache'

const usage = () => ({
  edgeH: new Int16Array(100),
  edgeV: new Int16Array(100),
  passH: new Int16Array(100),
  passV: new Int16Array(100),
  bend: new Int16Array(100),
})

describe('route search cache', () => {
  it('invalidates every dependency, including the incoming west and north edges', ({ expect }) => {
    const counters = usage()
    const cache = new RouteCache(1, 10, counters)
    const path = [55, 56]
    expect(cache.begin(0)).toBe(true)
    expect(cache.observe(55)).toBe(true)
    cache.set(0, path)
    expect(cache.get(0)).toBe(path)
    for (
      const [array, index] of [
        [counters.edgeH, 55],
        [counters.edgeH, 54],
        [counters.edgeV, 55],
        [counters.edgeV, 45],
        [counters.passH, 55],
        [counters.passV, 55],
        [counters.bend, 55],
      ] as const
    ) {
      array[index] = 1
      expect(cache.get(0)).toBeUndefined()
      array[index] = 0
      expect(cache.get(0)).toBe(path)
    }
    counters.edgeH[90] = 1
    expect(cache.get(0)).toBe(path)
  })

  it('deduplicates cells and disables recordings that exceed the per-arrow budget', ({ expect }) => {
    const cache = new RouteCache(2, 10, usage(), 36)
    expect(cache.begin(0)).toBe(true)
    expect(cache.observe(0)).toBe(true)
    expect(cache.observe(0)).toBe(true)
    cache.set(0, [0])
    expect(cache.get(0)).toEqual([0])
    expect(cache.begin(0)).toBe(true)
    expect(cache.observe(0)).toBe(true)
    expect(cache.observe(1)).toBe(false)
    expect(cache.get(0)).toBeUndefined()
    expect(cache.begin(0)).toBe(false)
    expect(cache.begin(1)).toBe(true)
  })
})
