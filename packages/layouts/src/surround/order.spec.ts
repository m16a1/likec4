import { describe, it } from 'vitest'
import { type SurroundGraph, random } from './annealer'
import { circularOrder } from './order'

describe('circularOrder', () => {
  it('preserves uncached search results across dense sketches', ({ expect }) => {
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = random(seed)
      const n = 12 + Math.floor(rnd() * 30), ni = 1 + Math.floor(rnd() * Math.min(8, n - 4))
      const graph: SurroundGraph = {
        sizes: Array.from({ length: n }, () => [120, 90]),
        edges: Array.from({ length: 20 + Math.floor(rnd() * 80) }, () => {
          const s = Math.floor(rnd() * n)
          return [s, (s + 1 + Math.floor(rnd() * (n - 1))) % n]
        }),
        inner: Array.from({ length: ni }, (_, i) => i),
        outer: Array.from({ length: n - ni }, (_, i) => ni + i),
      }
      // Dense graphs include repeated arrows and shared barycentres; small graphs
      // exercise collinear and touching segments throughout the search.
      const cachedRandom = random(seed), uncachedRandom = random(seed)
      expect(circularOrder(graph, cachedRandom, 200), `seed ${seed}`)
        .toEqual(circularOrder(graph, uncachedRandom, 200, false))
      expect(cachedRandom(), `random state after seed ${seed}`).toBe(uncachedRandom())
    }
  })
  for (const { nodes, arrows } of [{ nodes: 40, arrows: 18 }, { nodes: 12, arrows: 2100 }]) {
    it(`preserves search results when a scratch table is skipped (${nodes} nodes, ${arrows} arrows)`, ({ expect }) => {
      const rnd = random(31)
      const graph: SurroundGraph = {
        sizes: Array.from({ length: nodes }, () => [120, 90]),
        edges: Array.from({ length: arrows }, (_, i) => {
          const a = i % 4
          return [a, (a + 1 + Math.floor(rnd() * (nodes - 1))) % nodes]
        }),
        inner: [0, 1, 2, 3],
        outer: Array.from({ length: nodes - 4 }, (_, i) => i + 4),
      }
      const optimizedRandom = random(5), referenceRandom = random(5)
      expect(circularOrder(graph, optimizedRandom, 20)).toEqual(circularOrder(graph, referenceRandom, 20, false))
      expect(optimizedRandom()).toBe(referenceRandom())
    })
  }
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
