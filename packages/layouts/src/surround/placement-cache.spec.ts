import { describe, it } from 'vitest'
import { PlacementCache } from './placement-cache'

const placement = { centers: [[10, 20] as const], polylines: [[[10, 20] as const, [30, 40] as const]] }

describe('completed placement cache', () => {
  it('evicts the least recently used entry and isolates retrieved geometry', ({ expect }) => {
    const cache = new PlacementCache(4096, 2)
    cache.set('a', placement)
    cache.set('b', placement)
    const first = cache.get('a')!
    first.centers[0] = [100, 200]
    first.polylines[0]!.push([300, 400])
    cache.set('c', placement)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toEqual(placement)
    expect(cache.get('c')).toEqual(placement)
  })

  it('bounds serialized geometry and key memory, including replacements', ({ expect }) => {
    const entryBytes = (1 + JSON.stringify(placement).length) * 2
    const cache = new PlacementCache(entryBytes * 2)
    cache.set('a', placement)
    cache.set('b', placement)
    cache.set('b', placement)
    expect(cache.get('a')).toEqual(placement)
    cache.set('c', placement)
    expect(cache.get('b')).toBeUndefined()
    cache.set('oversized'.repeat(100), placement)
    expect(cache.get('c')).toEqual(placement)
    expect(cache.get('oversized'.repeat(100))).toBeUndefined()
  })
})
