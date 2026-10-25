import { describe, it } from 'vitest'
import { type SurroundGraph, random } from './annealer'
import { circularOrder } from './order'

describe('circularOrder', () => {
  it('does not interleave the neighbours of two inner nodes', ({ expect }) => {
    // inner nodes 0..2 not connected to each other, each with its own three neighbours:
    // two groups interleaving around the cycle (x..y..x..y) force a crossing, nesting does not
    const inner = [0, 1, 2]
    const outer = [3, 4, 5, 6, 7, 8, 9, 10, 11]
    const edges: Array<[number, number]> = []
    outer.forEach((v, k) => edges.push([inner[Math.floor(k / 3)]!, v]))
    const graph: SurroundGraph = { sizes: [...inner, ...outer].map(() => [100, 60]), edges, inner, outer }
    const order = circularOrder(graph, random(1))
    expect([...order].sort((a, b) => a - b)).toEqual(outer)
    const group = (v: number) => Math.floor((v - 3) / 3)
    for (const [g, h] of [[0, 1], [0, 2], [1, 2]] as const) {
      const pair = order.map(group).filter(x => x === g || x === h)
      const changes = pair.filter((x, k) => x !== pair.at(k - 1)).length
      expect.soft(changes, `groups ${g} and ${h}: ${pair.join('')}`).toBe(2)
    }
  })
})
