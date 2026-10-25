import Graph from 'graphology'
import { describe, expect, it } from 'vitest'
import { willCreateCycle } from './will-create-cycle'

function graph(edges: Array<[string, string]>) {
  const g = new Graph({ type: 'directed', multi: true, allowSelfLoops: true })
  for (const [s, t] of edges) {
    g.mergeNode(s)
    g.mergeNode(t)
    g.mergeDirectedEdge(s, t)
  }
  return g
}

describe('willCreateCycle', () => {
  it('detects self-loops and back edges', () => {
    const g = graph([['a', 'b'], ['b', 'c']])
    expect(willCreateCycle(g, 'a', 'a')).toBe(true)
    expect(willCreateCycle(g, 'b', 'a')).toBe(true)
    expect(willCreateCycle(g, 'c', 'a')).toBe(true)
  })

  it('allows edges that keep the graph acyclic', () => {
    const g = graph([['a', 'b'], ['b', 'c']])
    expect(willCreateCycle(g, 'a', 'c')).toBe(false)
    expect(willCreateCycle(g, 'a', 'b')).toBe(false)
    expect(willCreateCycle(g, 'a', 'missing')).toBe(false)
  })

  it('is fast on dense DAGs with exponentially many paths', () => {
    // layered DAG: 30 layers x 4 nodes, every node connects to every node in the next layer (4^29 paths)
    const edges: Array<[string, string]> = []
    for (let l = 0; l < 29; l++) {
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          edges.push([`${l}-${i}`, `${l + 1}-${j}`])
        }
      }
    }
    const g = graph(edges)
    g.mergeNode('outside')
    const start = performance.now()
    expect(willCreateCycle(g, 'outside', '0-0')).toBe(false)
    expect(willCreateCycle(g, '29-0', '0-0')).toBe(true)
    expect(performance.now() - start).toBeLessThan(100)
  })
})
