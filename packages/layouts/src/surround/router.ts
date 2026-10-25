import type { Point } from '@likec4/core/geometry'
import { orthoMetrics } from './metrics'

/**
 * Orthogonal routing of arrows between placed boxes on a uniform grid.
 *
 * Grid lines are STEP apart, more than MIN_GAP, so arrows on different lines are never too close to tell
 * apart and two arrows sharing a grid edge lie on top of each other. Each arrow is a cheapest path over
 * (grid node, direction) paying for crossings, overlaps, running along unrelated boxes, bends and length;
 * paths never pass through unrelated boxes. Arrows are routed one by one, then repeatedly ripped up and
 * rerouted against all the others, keeping the best round.
 */

type XY = Point

export interface GridRouteOptions {
  /** Rip-up and reroute rounds */
  readonly rounds?: number
  readonly seed?: number
}

/** Distance between grid lines */
const STEP = 30
/** Boxes are shrunk by this before testing grid nodes against them */
const SHRINK = 4
/** Parallel segments closer than this to a box side run along it */
const MIN_GAP = 24
/** Arrows leave and enter boxes at least this far from the corners */
const CORNER = 15
/** Free grid lines around the drawing */
const MARGIN = 4

const W_CROSS = 1
const W_OVERLAP = 2
const W_HUG = 0.4
const W_BEND = 0.03
/** Per grid step; a crossing is worth a detour of about 65 steps */
const W_STEP = 0.015

/** Directions: right, down, left, up */
const DX = [1, 0, -1, 0] as const
const DY = [0, 1, 0, -1] as const

/** Binary min-heap of integer values by numeric keys */
class Heap {
  private readonly keys: number[] = []
  private readonly values: number[] = []

  get size(): number {
    return this.keys.length
  }

  push(key: number, value: number) {
    const { keys, values } = this
    let i = keys.length
    keys.push(key)
    values.push(value)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (keys[parent]! <= key) {
        break
      }
      keys[i] = keys[parent]!
      values[i] = values[parent]!
      i = parent
    }
    keys[i] = key
    values[i] = value
  }

  /** Removes the entry with the smallest key, returns its key and value */
  pop(): readonly [number, number] {
    const { keys, values } = this
    const top = [keys[0]!, values[0]!] as const
    const lastKey = keys.pop()!, lastValue = values.pop()!
    const n = keys.length
    if (n > 0) {
      let i = 0
      while (true) {
        let child = 2 * i + 1
        if (child >= n) {
          break
        }
        if (child + 1 < n && keys[child + 1]! < keys[child]!) {
          child++
        }
        if (keys[child]! >= lastKey) {
          break
        }
        keys[i] = keys[child]!
        values[i] = values[child]!
        i = child
      }
      keys[i] = lastKey
      values[i] = lastValue
    }
    return top
  }
}

/**
 * Readability penalty of routed arrows: crossings, arrows on top of or too close to each other,
 * running along or through unrelated boxes. Lower is better.
 */
export function routeScore(
  sizes: ReadonlyArray<XY>,
  centers: ReadonlyArray<XY>,
  edges: ReadonlyArray<readonly [number, number]>,
  polylines: ReadonlyArray<ReadonlyArray<XY>>,
): number {
  const m = orthoMetrics(
    polylines.map((points, e) => ({
      points: points.map(([x, y]) => ({ x, y })),
      source: edges[e]![0],
      target: edges[e]![1],
    })),
    sizes.map(([w, h], i) => ({ x: centers[i]![0] - w / 2, y: centers[i]![1] - h / 2, width: w, height: h })),
  )
  return W_CROSS * m.crossings + W_OVERLAP * m.overlaps + m.tooClose + m.hugging + 6 * m.through
}

/**
 * Routes every arrow between boxes given by sizes and centres.
 * Returns one polyline per arrow, from a point inside the source box to a point inside the target box,
 * with horizontal and vertical segments only.
 */
export function gridRoute(
  sizes: ReadonlyArray<XY>,
  centers: ReadonlyArray<XY>,
  edges: ReadonlyArray<readonly [number, number]>,
  options: GridRouteOptions = {},
): XY[][] {
  const rounds = options.rounds ?? 6
  const boxes = sizes.map(([w, h], i) => {
    const [x, y] = centers[i]!
    return [x - w / 2, y - h / 2, x + w / 2, y + h / 2] as const
  })
  const minX = Math.min(...boxes.map(b => b[0])) - MARGIN * STEP
  const minY = Math.min(...boxes.map(b => b[1])) - MARGIN * STEP
  const NX = Math.ceil((Math.max(...boxes.map(b => b[2])) + MARGIN * STEP - minX) / STEP) + 1
  const NY = Math.ceil((Math.max(...boxes.map(b => b[3])) + MARGIN * STEP - minY) / STEP) + 1
  const N = NX * NY
  const gx = (v: number) => minX + (v % NX) * STEP
  const gy = (v: number) => minY + Math.floor(v / NX) * STEP

  // the box strictly containing a grid node, and the box along whose sides it lies
  const inside = new Int32Array(N).fill(-1)
  const along = new Int32Array(N).fill(-1)
  boxes.forEach(([x0, y0, x1, y1], b) => {
    const i0 = Math.max(0, Math.floor((x0 - MIN_GAP - minX) / STEP))
    const i1 = Math.min(NX - 1, Math.ceil((x1 + MIN_GAP - minX) / STEP))
    const j0 = Math.max(0, Math.floor((y0 - MIN_GAP - minY) / STEP))
    const j1 = Math.min(NY - 1, Math.ceil((y1 + MIN_GAP - minY) / STEP))
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const v = j * NX + i, x = gx(v), y = gy(v)
        switch (true) {
          case x > x0 + SHRINK && x < x1 - SHRINK && y > y0 + SHRINK && y < y1 - SHRINK:
            inside[v] = b
            break
          case x > x0 - MIN_GAP && x < x1 + MIN_GAP && y > y0 - MIN_GAP && y < y1 + MIN_GAP:
            along[v] = b
            break
        }
      }
    }
  })
  /** Leaving or entering box `b` at node `v` in direction `d` keeps away from its corners */
  const port = (v: number, b: number, d: number) => {
    const [x0, y0, x1, y1] = boxes[b]!
    return d % 2 === 0
      ? gy(v) >= y0 + CORNER && gy(v) <= y1 - CORNER
      : gx(v) >= x0 + CORNER && gx(v) <= x1 - CORNER
  }

  // usage by routed arrows: horizontal edge v→v+1 at edgeH[v], vertical edge v→v+NX at edgeV[v],
  // arrows passing straight through a node, and arrows bending there
  const edgeH = new Int16Array(N), edgeV = new Int16Array(N)
  const passH = new Int16Array(N), passV = new Int16Array(N), bend = new Int16Array(N)

  /** Adds (+1) or removes (-1) a routed path from the usage counters */
  const use = (path: ReadonlyArray<number>, s: number, t: number, sign: 1 | -1) => {
    const own = (v: number) => inside[v] === s || inside[v] === t
    for (let k = 0; k + 1 < path.length; k++) {
      const a = path[k]!, b = path[k + 1]!
      if (own(a) && own(b)) {
        continue
      }
      const horiz = Math.abs(a - b) === 1
      if (horiz) {
        edgeH[Math.min(a, b)]! += sign
      } else {
        edgeV[Math.min(a, b)]! += sign
      }
      if (k > 0 && !own(a)) {
        const horizIn = Math.abs(path[k - 1]! - a) === 1
        switch (true) {
          case horizIn !== horiz:
            bend[a]! += sign
            break
          case horiz:
            passH[a]! += sign
            break
          default:
            passV[a]! += sign
        }
      }
    }
  }

  const dist = new Float64Array(N * 4).fill(Infinity)
  const prev = new Int32Array(N * 4)
  const touched: number[] = []

  /** Cheapest path of arrow `e` against the arrows routed so far, as grid nodes */
  const route = (e: number): number[] | null => {
    const [s, t] = edges[e]!
    for (const state of touched) {
      dist[state] = Infinity
    }
    touched.length = 0
    const heap = new Heap()
    const [tx0, ty0, tx1, ty1] = boxes[t]!
    // admissible estimate: the remaining steps to the target box
    const estimate = (v: number) => {
      const dx = Math.max(0, tx0 - gx(v), gx(v) - tx1), dy = Math.max(0, ty0 - gy(v), gy(v) - ty1)
      return (dx + dy) / STEP * W_STEP
    }
    // every grid node inside the source box is a start
    const [sx0, sy0, sx1, sy1] = boxes[s]!
    const i0 = Math.max(0, Math.ceil((sx0 - minX) / STEP)), i1 = Math.min(NX - 1, Math.floor((sx1 - minX) / STEP))
    const j0 = Math.max(0, Math.ceil((sy0 - minY) / STEP)), j1 = Math.min(NY - 1, Math.floor((sy1 - minY) / STEP))
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const v = j * NX + i
        if (inside[v] !== s) {
          continue
        }
        for (let d = 0; d < 4; d++) {
          const state = v * 4 + d
          dist[state] = 0
          prev[state] = -1
          touched.push(state)
          heap.push(estimate(v), state)
        }
      }
    }
    while (heap.size > 0) {
      const [key, state] = heap.pop()
      const v = state >> 2, dirIn = state & 3
      const g = dist[state]!
      if (key - estimate(v) > g + 1e-9) {
        continue
      }
      if (inside[v] === t) {
        const path: number[] = []
        for (let x = state; x !== -1; x = prev[x]!) {
          path.push(x >> 2)
        }
        path.reverse()
        // start from the last node inside the source box
        let k = 0
        while (k + 1 < path.length && inside[path[k + 1]!] === s) {
          k++
        }
        return path.slice(k)
      }
      const vi = v % NX, vj = (v - vi) / NX
      const ownV = inside[v] === s || inside[v] === t
      const start = prev[state] === -1
      for (let d = 0; d < 4; d++) {
        if (!start && d === ((dirIn + 2) & 3)) {
          continue
        }
        const wi = vi + DX[d]!, wj = vj + DY[d]!
        if (wi < 0 || wj < 0 || wi >= NX || wj >= NY) {
          continue
        }
        const w = wj * NX + wi
        const box = inside[w]!
        if (box >= 0 && box !== s && box !== t) {
          continue
        }
        const ownW = box === s || box === t
        if (ownV !== ownW && !port(ownV ? v : w, ownV ? inside[v]! : box, d)) {
          continue
        }
        let cost = 0
        if (!ownV || !ownW) {
          cost += W_STEP + W_OVERLAP * (d % 2 === 0 ? edgeH[Math.min(v, w)]! : edgeV[Math.min(v, w)]!)
          const side = along[w]!
          if (side >= 0 && side !== s && side !== t && along[v] === side) {
            cost += W_HUG
          }
        }
        if (!ownV && !start) {
          cost += d === dirIn
            ? W_CROSS * (d % 2 === 0 ? passV[v]! : passH[v]!) + W_OVERLAP * bend[v]!
            : W_BEND + W_CROSS * (passH[v]! + passV[v]! + bend[v]!)
        }
        const next = w * 4 + d
        if (g + cost < dist[next]! - 1e-12) {
          if (dist[next] === Infinity) {
            touched.push(next)
          }
          dist[next] = g + cost
          prev[next] = state
          heap.push(g + cost + estimate(w), next)
        }
      }
    }
    return null
  }

  const toPolyline = (path: ReadonlyArray<number>): XY[] => {
    const points = path.map((v): XY => [gx(v), gy(v)])
    const result: XY[] = [points[0]!]
    for (let k = 1; k + 1 < points.length; k++) {
      const a = result.at(-1)!, b = points[k]!, c = points[k + 1]!
      if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) {
        continue
      }
      result.push(b)
    }
    if (points.length > 1) {
      result.push(points.at(-1)!)
    }
    return result
  }
  const fallback = (e: number): XY[] => {
    const [s, t] = edges[e]!
    return [centers[s]!, [centers[t]![0], centers[s]![1]], centers[t]!]
  }

  const paths: Array<number[] | null> = edges.map(() => null)
  const polylines = () => paths.map((p, e) => p ? toPolyline(p) : fallback(e))
  const score = () => routeScore(sizes, centers, edges, polylines())

  // shortest arrows first, then rip up and reroute in random order
  const length = (e: number) => {
    const [s, t] = edges[e]!
    return Math.abs(centers[s]![0] - centers[t]![0]) + Math.abs(centers[s]![1] - centers[t]![1])
  }
  const order = edges.map((_, e) => e).sort((a, b) => length(a) - length(b))
  let seed = (options.seed ?? 1) >>> 0
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  let best: { score: number; polylines: XY[][] } = { score: Infinity, polylines: [] }
  for (let round = 0; round <= rounds; round++) {
    if (round > 0) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1))
        ;[order[i], order[j]] = [order[j]!, order[i]!]
      }
    }
    for (const e of order) {
      const [s, t] = edges[e]!
      const old = paths[e]
      if (old) {
        use(old, s, t, -1)
      }
      const path = route(e) ?? old ?? null
      paths[e] = path
      if (path) {
        use(path, s, t, 1)
      }
    }
    const current = score()
    if (current < best.score) {
      best = { score: current, polylines: polylines() }
    }
  }
  return best.polylines
}
