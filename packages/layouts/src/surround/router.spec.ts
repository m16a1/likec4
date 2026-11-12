import type { Point } from '@likec4/core/geometry'
import { createHash } from 'node:crypto'
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
  it('preserves the original routes across heap growth and rerouting', ({ expect }) => {
    // K3,3 requires a crossing and keeps the rerouting searches active.
    const sizes: XY[] = Array.from({ length: 6 }, () => [240, 150])
    const centers: XY[] = [[-800, -600], [-800, 0], [-800, 600], [800, -600], [800, 0], [800, 600]]
    const edges: Array<readonly [number, number]> = Array.from({ length: 9 }, (_, i) => [Math.floor(i / 3), 3 + i % 3])
    // Recorded from the original 2690155f1 binary heap and routing implementation.
    for (
      const { seed, geometry } of [
        {
          'seed': 1,
          'geometry': 'ea7d41ce57535dee39e5b09e0129aaa8663611218d3b04068710bd9493d8dee4',
        },
        {
          'seed': 3,
          'geometry': 'ea7d41ce57535dee39e5b09e0129aaa8663611218d3b04068710bd9493d8dee4',
        },
        {
          'seed': 17,
          'geometry': 'ea7d41ce57535dee39e5b09e0129aaa8663611218d3b04068710bd9493d8dee4',
        },
      ]
    ) {
      const routes = gridRoute(sizes, centers, edges, { seed, rounds: 2 })
      expect(createHash('sha256').update(JSON.stringify(routes)).digest('hex'), `seed ${seed}`).toBe(geometry)
    }
  })
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

  it('keeps ports away from corners when routing in every direction', ({ expect }) => {
    const sizes: XY[] = [[210, 150], [210, 150], [210, 150], [210, 150], [210, 150]]
    const centers: XY[] = [[0, 0], [600, 0], [0, 600], [-600, 0], [0, -600]]
    const edges = [[0, 1], [2, 0], [0, 3], [4, 0]] as const
    const paths = gridRoute(sizes, centers, edges)
    expect(measure(sizes, centers, [...edges], paths)).toMatchObject({ through: 0, diagonal: 0, overlaps: 0 })
    for (const [e, points] of paths.entries()) {
      for (const [node, point] of [[edges[e]![0], points[0]!], [edges[e]![1], points.at(-1)!]] as const) {
        const [x, y] = point, [cx, cy] = centers[node]!, [w, h] = sizes[node]!
        // A port on either side must stay within the middle of at least one axis.
        expect(Math.abs(x - cx) <= w / 2 - 15 || Math.abs(y - cy) <= h / 2 - 15).toBe(true)
      }
    }
  })

  it('keeps the first perfect round when more rounds are requested', ({ expect }) => {
    const sizes: XY[] = [[200, 100], [200, 100]]
    const centers: XY[] = [[0, 0], [600, 0]]
    const edges = [[0, 1] as const]
    const first = gridRoute(sizes, centers, edges, { rounds: 0 })
    expect(measure(sizes, centers, edges, first)).toMatchObject({
      crossings: 0,
      overlaps: 0,
      tooClose: 0,
      hugging: 0,
      through: 0,
    })
    expect(gridRoute(sizes, centers, edges, { rounds: 20 })).toEqual(first)
  })
})
