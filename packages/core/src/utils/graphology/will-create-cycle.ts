import type { AbstractGraph } from 'graphology-types'

/**
 * Checks whether adding a directed edge `source -> target` would create a cycle,
 * i.e. whether `source` is reachable from `target`.
 *
 * Same semantics as `graphology-dag/will-create-cycle`, but tracks visited nodes.
 * The original implementation walks every path instead of every node,
 * which is exponential on dense DAGs (large landscapes never finish computing).
 */
export function willCreateCycle(graph: AbstractGraph, source: unknown, target: unknown): boolean {
  const from = String(source)
  const to = String(target)
  if (from === to) {
    return true
  }
  if (!graph.hasNode(from) || !graph.hasNode(to) || graph.hasDirectedEdge(from, to)) {
    return false
  }
  if (graph.hasDirectedEdge(to, from)) {
    return true
  }
  const visited = new Set<string>([to])
  const stack = [to]
  let node
  while ((node = stack.pop()) !== undefined) {
    for (const next of graph.outNeighbors(node)) {
      if (next === from) {
        return true
      }
      if (!visited.has(next)) {
        visited.add(next)
        stack.push(next)
      }
    }
  }
  return false
}
