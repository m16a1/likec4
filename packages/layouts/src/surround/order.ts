import type { SurroundGraph } from './annealer'

/**
 * Cyclic order of the outer nodes around the system box with few crossings, found on a sketch:
 * outer nodes on a circle in that order, inner nodes at the barycentre of their neighbours (Tutte),
 * arrows between inner and outer nodes as straight segments, arrows between outer nodes outside the circle.
 * For a graph that can be drawn without crossings with the outer nodes outside the box, the best order has
 * no crossings on the sketch either.
 */
export function circularOrder(graph: SurroundGraph, rnd: () => number, evaluations?: number): number[] {
  const { inner, outer, edges } = graph
  const m = outer.length
  const order = [...outer]
  if (m < 3) {
    return order
  }
  /** Position of each outer node in the order */
  const slotOf = new Map<number, number>()
  const innerIndex = new Map(inner.map((v, i) => [v, i]))
  const isInner = (v: number) => innerIndex.has(v)
  const outerEdges: Array<[number, number]> = []
  const sketchEdges: Array<[number, number]> = []
  const adj = inner.map((): number[] => [])
  for (const [s, t] of edges) {
    if (isInner(s) || isInner(t)) {
      sketchEdges.push([s, t])
    } else {
      outerEdges.push([s, t])
    }
    if (isInner(s)) {
      adj[innerIndex.get(s)!]!.push(t)
    }
    if (isInner(t)) {
      adj[innerIndex.get(t)!]!.push(s)
    }
  }
  const px = new Float64Array(graph.sizes.length), py = new Float64Array(graph.sizes.length)

  const layout = (iterations: number) => {
    order.forEach((v, k) => {
      slotOf.set(v, k)
      px[v] = Math.cos(2 * Math.PI * k / m)
      py[v] = Math.sin(2 * Math.PI * k / m)
    })
    for (let it = 0; it < iterations; it++) {
      inner.forEach((v, i) => {
        const nb = adj[i]!
        if (nb.length === 0) {
          return
        }
        let x = 0, y = 0
        for (const u of nb) {
          x += px[u]!
          y += py[u]!
        }
        px[v] = x / nb.length
        py[v] = y / nb.length
      })
    }
  }

  const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)

  const crossings = () => {
    let total = 0
    for (let i = 0; i < sketchEdges.length; i++) {
      const [a, b] = sketchEdges[i]!
      for (let j = i + 1; j < sketchEdges.length; j++) {
        const [c, d] = sketchEdges[j]!
        if (a === c || a === d || b === c || b === d) {
          continue
        }
        const d1 = orient(px[a]!, py[a]!, px[b]!, py[b]!, px[c]!, py[c]!)
        const d2 = orient(px[a]!, py[a]!, px[b]!, py[b]!, px[d]!, py[d]!)
        const d3 = orient(px[c]!, py[c]!, px[d]!, py[d]!, px[a]!, py[a]!)
        const d4 = orient(px[c]!, py[c]!, px[d]!, py[d]!, px[b]!, py[b]!)
        // touching counts too: inner nodes with the same barycentre would otherwise hide crossings
        const eps = 1e-9
        if (d1 * d2 > eps || d3 * d4 > eps) {
          continue
        }
        const collinear = Math.abs(d1) < eps && Math.abs(d2) < eps
        if (
          !collinear
          || Math.max(px[a]!, px[b]!) >= Math.min(px[c]!, px[d]!) - eps
            && Math.max(px[c]!, px[d]!) >= Math.min(px[a]!, px[b]!) - eps
            && Math.max(py[a]!, py[b]!) >= Math.min(py[c]!, py[d]!) - eps
            && Math.max(py[c]!, py[d]!) >= Math.min(py[a]!, py[b]!) - eps
        ) {
          total++
        }
      }
    }
    // arrows between outer nodes cross when their ends interleave on the circle
    for (let i = 0; i < outerEdges.length; i++) {
      const a = slotOf.get(outerEdges[i]![0])!, b = slotOf.get(outerEdges[i]![1])!
      const lo = Math.min(a, b), hi = Math.max(a, b)
      for (let j = i + 1; j < outerEdges.length; j++) {
        const c = slotOf.get(outerEdges[j]![0])!, d = slotOf.get(outerEdges[j]![1])!
        if (c === a || c === b || d === a || d === b) {
          continue
        }
        if ((c > lo && c < hi) !== (d > lo && d < hi)) {
          total++
        }
      }
    }
    return total
  }

  for (let i = m - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  layout(200)
  let current = crossings()
  let best = current, bestOrder = [...order]
  const budget = evaluations ?? Math.round(Math.min(30_000, Math.max(3_000, 3e7 / Math.max(1, edges.length) ** 2)))
  const T0 = 1.5, T1 = 0.05
  // annealing over the order: move one node to another position of the cycle
  for (let it = 0; it < budget && best > 0; it++) {
    const T = T0 * (T1 / T0) ** (it / budget)
    const from = Math.floor(rnd() * m), to = Math.floor(rnd() * m)
    if (from === to) {
      continue
    }
    const [v] = order.splice(from, 1)
    order.splice(to, 0, v!)
    layout(30)
    const next = crossings()
    if (next <= current || rnd() < Math.exp((current - next) / T)) {
      current = next
      if (current < best) {
        best = current
        bestOrder = [...order]
      }
    } else {
      order.splice(to, 1)
      order.splice(from, 0, v!)
    }
  }
  return bestOrder
}
