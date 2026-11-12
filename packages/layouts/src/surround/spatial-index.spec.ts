import { describe, it } from 'vitest'
import { SpatialIndex } from './spatial-index'

describe('scoring spatial index', () => {
  it('deduplicates intersected cells and keeps IDs ordered across bitset words', ({ expect }) => {
    const index = new SpatialIndex(70, [-512, -512, 512, 512])
    for (const id of [69, 32, 31, 0]) {
      index.update(id, -300, 0, 300, 0, true)
      index.update(id, 0, -300, 0, 300, true)
    }
    index.clearQuery()
    index.include(-300, -300, 300, 300)
    index.include(0, 0, 0, 0)
    expect(index.values()).toEqual([0, 31, 32, 69])
    index.update(32, -300, 0, 300, 0, false)
    index.update(32, 0, -300, 0, 300, false)
    index.update(32, -500, -500, -490, -490, true)
    index.clearQuery()
    index.include(0, 0, 0, 0)
    expect(index.values()).toEqual([0, 31, 69])
  })

  it('includes touching boundaries and excludes remote cells', ({ expect }) => {
    const index = new SpatialIndex(2, [-512, -512, 512, 512])
    index.update(0, -256, -256, 0, 0, true)
    index.update(1, 400, 400, 450, 450, true)
    index.clearQuery()
    index.include(0, 0, 0, 0)
    expect(index.values()).toEqual([0])
    index.clearQuery()
    index.include(-512, 400, -500, 450)
    expect(index.values()).toEqual([])
  })
})
