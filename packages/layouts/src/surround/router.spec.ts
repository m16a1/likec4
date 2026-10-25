import type { Point } from '@likec4/core/geometry'
import { describe, it } from 'vitest'
import { orthoMetrics } from './metrics'
import { gridRoute } from './router'

type XY = Point

function measure(sizes: XY[], centers: XY[], edges: Array<readonly [number, number]>, polylines: XY[][]) {
  return orthoMetrics(
    polylines.map((points, e) => ({
      points: points.map(([x, y]) => ({ x, y })),
      source: edges[e]![0],
      target: edges[e]![1],
    })),
    sizes.map(([w, h], i) => ({ x: centers[i]![0] - w / 2, y: centers[i]![1] - h / 2, width: w, height: h })),
  )
}

describe('gridRoute', () => {
  it('goes around a box standing between source and target', ({ expect }) => {
    const sizes: XY[] = [[200, 100], [200, 100], [200, 300]]
    const centers: XY[] = [[0, 0], [800, 0], [400, 0]]
    const edges = [[0, 1] as const]
    const polylines = gridRoute(sizes, centers, edges)
    const m = measure(sizes, centers, edges, polylines)
    expect(m).toMatchObject({ through: 0, diagonal: 0 })
    expect(polylines[0]!.length).toBeGreaterThan(2)
  })

  it('separates parallel arrows between the same boxes', ({ expect }) => {
    const sizes: XY[] = [[300, 150], [300, 150]]
    const centers: XY[] = [[0, 0], [900, 0]]
    const edges = [[0, 1] as const, [1, 0] as const, [0, 1] as const]
    const m = measure(sizes, centers, edges, gridRoute(sizes, centers, edges))
    expect(m).toMatchObject({ crossings: 0, overlaps: 0, tooClose: 0, through: 0, diagonal: 0 })
  })

  it('routes around a crossing when there is room', ({ expect }) => {
    // a hub with four neighbours, arrows to opposite neighbours would cross with straight routes
    const sizes: XY[] = [[300, 300], [200, 100], [200, 100], [200, 100], [200, 100]]
    const centers: XY[] = [[0, 0], [-600, 0], [600, 0], [0, -500], [0, 500]]
    const edges = [[1, 2] as const, [3, 4] as const, [0, 1] as const, [0, 3] as const]
    const m = measure(sizes, centers, edges, gridRoute(sizes, centers, edges))
    expect(m).toMatchObject({ through: 0, overlaps: 0, diagonal: 0 })
    expect(m.crossings).toBeLessThanOrEqual(1)
  })

  it('is deterministic', ({ expect }) => {
    const sizes: XY[] = [[200, 100], [200, 100], [200, 100]]
    const centers: XY[] = [[0, 0], [600, 300], [-400, 500]]
    const edges = [[0, 1] as const, [1, 2] as const, [2, 0] as const]
    expect(gridRoute(sizes, centers, edges, { seed: 3 })).toEqual(gridRoute(sizes, centers, edges, { seed: 3 }))
  })
})
