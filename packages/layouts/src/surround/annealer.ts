import type { Point } from '@likec4/core/geometry'

/**
 * Crossing minimisation for the `surround` placement: boxes on slots, each arrow an orthogonal
 * route with one of a few shapes, optimised with simulated annealing.
 */

export type XY = Point

export interface SurroundGraph {
  /** Width and height per node */
  readonly sizes: ReadonlyArray<XY>
  /** Source and target node index per arrow, no self-loops */
  readonly edges: ReadonlyArray<XY>
  /** Nodes placed on the interior grid (inside the system box) */
  readonly inner: ReadonlyArray<number>
  /** Nodes placed on the frame around the system box */
  readonly outer: ReadonlyArray<number>
}

export interface SurroundSlots {
  readonly inner: ReadonlyArray<XY>
  /** Sorted by angle around the box centre, so that neighbouring indexes are neighbouring slots */
  readonly outer: ReadonlyArray<XY>
  /** Interior grid outline: x0, y0, x1, y1 */
  readonly box: readonly [number, number, number, number]
}

export interface AnnealOptions {
  readonly iterations: number
  readonly seed: number
  /** Target width to height ratio of the frame */
  readonly aspect: number
  /** Interior grid cells per inner node */
  readonly spare: number
  /** Cyclic order of the outer nodes to start from, random by default */
  readonly outerOrder?: ReadonlyArray<number> | undefined
  /** Start temperature, lower keeps more of the start arrangement */
  readonly t0?: number | undefined
}

export interface AnnealResult {
  /** Box centre per node */
  readonly centers: XY[]
  /** Polyline per arrow from source centre to target centre, horizontal and vertical segments only */
  readonly polylines: XY[][]
  readonly slots: SurroundSlots
  /** Final value of the cost function, lower is better */
  readonly cost: number
}

/** Corridor between neighbour boxes and around the system box */
const GAP = 90
/** Shorter segments are tiny jogs */
const MIN_SEGMENT = 20
/** Parallel segments closer than this lie on top of each other */
const OVERLAP_GAP = 3
/** Parallel segments closer than this are too close to tell apart... */
const MIN_GAP = 24
/** ...when they run side by side for longer than this */
const MIN_SHARED = 30
/** Ports keep this distance from box corners */
const PORT_INSET = 30
/** Boxes are shrunk by this before testing arrows against them */
const SHRINK = 4

const W_CROSS = 1
const W_OVERLAP = 2
const W_CLOSE = 1
const W_HUG = 1
const W_THROUGH = 6
const W_BEND = 0.03
const W_LEN = 1e-4
const W_JOG = 1
const W_SIDE = 0.5

type RouteKind = 'HV' | 'VH' | 'HVH' | 'VHV'
const ROUTES: ReadonlyArray<readonly [RouteKind, number]> = [
  ['HV', 0],
  ['VH', 0],
  ['HVH', 0.25],
  ['HVH', 0.5],
  ['HVH', 0.75],
  ['VHV', 0.25],
  ['VHV', 0.5],
  ['VHV', 0.75],
]

type Segment = {
  readonly horiz: boolean
  /** y of a horizontal segment, x of a vertical one */
  readonly c: number
  readonly lo: number
  readonly hi: number
}

type Slot = { readonly outer: boolean; readonly index: number }

/** Mulberry32, deterministic across platforms */
export function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(items: T[], rnd: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[items[i], items[j]] = [items[j]!, items[i]!]
  }
  return items
}

function maxOf(values: ReadonlyArray<number>): number {
  return values.reduce((a, b) => Math.max(a, b), 0)
}

/** Free grid cells inside the smallest frame of the given aspect around the box that has enough of them. */
function frameSlots(count: number, box: SurroundSlots['box'], nw: number, nh: number, aspect: number): XY[] {
  const [bx0, by0, bx1, by1] = box
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2
  const cw = nw + GAP, ch = nh + GAP
  const need = Math.max(count * 1.5, count + 6)
  let width = Math.max(bx1 - bx0 + 2 * (GAP + cw), aspect * (by1 - by0 + 2 * (GAP + ch)))
  while (true) {
    const height = width / aspect
    const ncol = Math.floor(width / cw), nrow = Math.floor(height / ch)
    const fx0 = cx - ncol * cw / 2, fy0 = cy - nrow * ch / 2
    const slots: XY[] = []
    for (let i = 0; i < ncol; i++) {
      for (let j = 0; j < nrow; j++) {
        const x = fx0 + cw / 2 + i * cw, y = fy0 + ch / 2 + j * ch
        // keep a corridor of GAP around the system box
        if (x + nw / 2 > bx0 - GAP && x - nw / 2 < bx1 + GAP && y + nh / 2 > by0 - GAP && y - nh / 2 < by1 + GAP) {
          continue
        }
        slots.push([x, y])
      }
    }
    if (slots.length >= need) {
      return slots
    }
    width += cw
  }
}

/**
 * Interior grid with `spare` cells per inner node, its outline closest to the target aspect,
 * and slots for the other nodes on a frame of that aspect around it.
 */
export function buildSlots(graph: SurroundGraph, aspect: number, spare: number): SurroundSlots {
  const innerSizes = graph.inner.map(n => graph.sizes[n]!)
  const iw = maxOf(innerSizes.map(s => s[0])), ih = maxOf(innerSizes.map(s => s[1]))
  const k = graph.inner.length
  const sx = iw + 120, sy = ih + 140
  let cols = 1, rows = 1
  if (k > 1) {
    const cells = Math.ceil(k * spare)
    let best = Infinity
    for (let c = 1; c <= cells; c++) {
      const diff = Math.abs(Math.log(c * sx / (Math.ceil(cells / c) * sy) / aspect))
      if (diff < best) {
        best = diff
        cols = c
      }
    }
    rows = Math.ceil(k * spare / cols)
  }
  const inner: XY[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      inner.push([c * sx, r * sy])
    }
  }
  // extra room at the top for the system title
  const box = [-iw / 2 - 40, -ih / 2 - 60, (cols - 1) * sx + iw / 2 + 40, (rows - 1) * sy + ih / 2 + 40] as const
  const outerSizes = graph.outer.map(n => graph.sizes[n]!)
  const nw = maxOf(outerSizes.map(s => s[0])), nh = maxOf(outerSizes.map(s => s[1]))
  const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2
  const outer = graph.outer.length > 0 ? frameSlots(graph.outer.length, box, nw, nh, aspect) : []
  outer.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx))
  return { inner, outer, box }
}

/** Outer slots in the ring next to the system box, from where arrows reach it without passing other slots */
export function innerRingSize(graph: SurroundGraph, slots: SurroundSlots): number {
  const [bx0, by0, bx1, by1] = slots.box
  const outerSizes = graph.outer.map(n => graph.sizes[n]!)
  const nw = maxOf(outerSizes.map(s => s[0])), nh = maxOf(outerSizes.map(s => s[1]))
  return slots.outer.filter(([x, y]) => {
    const dx = Math.max(bx0 - x, x - bx1, 0), dy = Math.max(by0 - y, y - by1, 0)
    return dx < GAP + nw && dy < GAP + nh
  }).length
}

class SurroundState {
  readonly centers: XY[]
  readonly slotOf: Slot[]
  readonly innerOcc: Array<number | undefined>
  readonly outerOcc: Array<number | undefined>
  /** Incident arrows per node */
  readonly incident: number[][]
  /** Port offset per arrow end, a fraction of the box side in [-0.5, 0.5] */
  readonly ports: Array<[number, number]>
  readonly routes: number[]
  readonly polylines: XY[][]
  readonly segments: Segment[][]
  /** Shrunk box per node: x0, y0, x1, y1 */
  readonly boxes: Array<[number, number, number, number]>
  private readonly inK: Uint8Array

  constructor(
    readonly graph: SurroundGraph,
    readonly slots: SurroundSlots,
    rnd: () => number,
    outerOrder?: ReadonlyArray<number>,
  ) {
    const n = graph.sizes.length
    this.centers = Array.from({ length: n }, (): XY => [0, 0])
    this.boxes = Array.from({ length: n }, (): [number, number, number, number] => [0, 0, 0, 0])
    this.slotOf = Array.from({ length: n }, (): Slot => ({ outer: false, index: 0 }))
    this.innerOcc = Array.from({ length: slots.inner.length }, () => undefined)
    this.outerOcc = Array.from({ length: slots.outer.length }, () => undefined)
    const step = slots.outer.length / Math.max(1, graph.outer.length)
    ;(outerOrder ?? shuffle([...graph.outer], rnd)).forEach((node, k) => {
      this.place(node, { outer: true, index: Math.floor(k * step) })
    })
    if (outerOrder) {
      this.placeInnerAtBarycentres()
    } else {
      graph.inner.forEach((node, i) => this.place(node, { outer: false, index: i }))
    }

    this.incident = Array.from({ length: n }, () => [])
    graph.edges.forEach(([s, t], e) => {
      this.incident[s]!.push(e)
      this.incident[t]!.push(e)
    })
    this.ports = graph.edges.map((): [number, number] => [0, 0])
    this.incident.forEach((edges, node) => {
      shuffle([...edges], rnd).forEach((e, k) => {
        this.ports[e]![graph.edges[e]![0] === node ? 0 : 1] = (k + 0.5) / edges.length - 0.5
      })
    })
    this.routes = graph.edges.map(() => Math.floor(rnd() * ROUTES.length))
    this.polylines = graph.edges.map(() => [])
    this.segments = graph.edges.map(() => [])
    this.inK = new Uint8Array(graph.edges.length)
    this.refresh(graph.edges.map((_, e) => e))
  }

  /**
   * Puts inner nodes at the barycentre of their neighbours (Tutte), with the outer nodes fixed,
   * then each on the nearest free grid cell, busiest first.
   */
  private placeInnerAtBarycentres() {
    const { graph, slots } = this
    const [bx0, by0, bx1, by1] = slots.box
    const pos = new Map<number, XY>(graph.inner.map(v => [v, [(bx0 + bx1) / 2, (by0 + by1) / 2]]))
    const adj = graph.sizes.map((): number[] => [])
    for (const [s, t] of graph.edges) {
      adj[s]!.push(t)
      adj[t]!.push(s)
    }
    for (let it = 0; it < 200; it++) {
      for (const v of graph.inner) {
        const neighbours = adj[v]!
        if (neighbours.length === 0) {
          continue
        }
        let x = 0, y = 0
        for (const u of neighbours) {
          const [ux, uy] = pos.get(u) ?? this.centers[u]!
          x += ux
          y += uy
        }
        pos.set(v, [x / neighbours.length, y / neighbours.length])
      }
    }
    // stretch the barycentres over the interior grid
    const xs = graph.inner.map(v => pos.get(v)![0]), ys = graph.inner.map(v => pos.get(v)![1])
    const gxs = slots.inner.map(p => p[0]), gys = slots.inner.map(p => p[1])
    const stretch = (value: number, from: ReadonlyArray<number>, to: ReadonlyArray<number>) => {
      const f0 = Math.min(...from), f1 = Math.max(...from), t0 = Math.min(...to), t1 = Math.max(...to)
      return f1 > f0 ? t0 + (value - f0) / (f1 - f0) * (t1 - t0) : (t0 + t1) / 2
    }
    const busiest = [...graph.inner].sort((a, b) => adj[b]!.length - adj[a]!.length)
    for (const v of busiest) {
      const x = stretch(pos.get(v)![0], xs, gxs), y = stretch(pos.get(v)![1], ys, gys)
      let nearest = -1, nearestDist = Infinity
      slots.inner.forEach(([sx, sy], i) => {
        const d = (sx - x) ** 2 + (sy - y) ** 2
        if (this.innerOcc[i] === undefined && d < nearestDist) {
          nearest = i
          nearestDist = d
        }
      })
      this.place(v, { outer: false, index: nearest })
    }
  }

  place(node: number, slot: Slot) {
    this.slotOf[node] = slot
    const [x, y] = slot.outer ? this.slots.outer[slot.index]! : this.slots.inner[slot.index]!
    if (slot.outer) {
      this.outerOcc[slot.index] = node
    } else {
      this.innerOcc[slot.index] = node
    }
    this.centers[node] = [x, y]
    const [w, h] = this.graph.sizes[node]!
    this.boxes[node] = [x - w / 2 + SHRINK, y - h / 2 + SHRINK, x + w / 2 - SHRINK, y + h / 2 - SHRINK]
  }

  occupant(slot: Slot): number | undefined {
    return slot.outer ? this.outerOcc[slot.index] : this.innerOcc[slot.index]
  }

  free(slot: Slot) {
    if (slot.outer) {
      this.outerOcc[slot.index] = undefined
    } else {
      this.innerOcc[slot.index] = undefined
    }
  }

  /** Recomputes polylines and segments of the given arrows */
  refresh(edges: Iterable<number>) {
    for (const e of edges) {
      const polyline = this.polyline(e)
      this.polylines[e] = polyline
      const segments: Segment[] = []
      for (let i = 0; i + 1 < polyline.length; i++) {
        const [x1, y1] = polyline[i]!, [x2, y2] = polyline[i + 1]!
        if (Math.abs(x1 - x2) < 0.5 && Math.abs(y1 - y2) < 0.5) {
          continue
        }
        segments.push(
          Math.abs(y1 - y2) < 0.5
            ? { horiz: true, c: y1, lo: Math.min(x1, x2), hi: Math.max(x1, x2) }
            : { horiz: false, c: x1, lo: Math.min(y1, y2), hi: Math.max(y1, y2) },
        )
      }
      this.segments[e] = segments
    }
  }

  private polyline(e: number): XY[] {
    const [a, b] = this.graph.edges[e]!
    const [sx, sy] = this.centers[a]!, [tx, ty] = this.centers[b]!
    const [sw, sh] = this.graph.sizes[a]!, [tw, th] = this.graph.sizes[b]!
    const [fs, ft] = this.ports[e]!
    const [kind, frac] = ROUTES[this.routes[e]!]!
    switch (kind) {
      case 'HV': {
        const y = sy + fs * (sh - PORT_INSET), x = tx + ft * (tw - PORT_INSET)
        return [[sx, y], [x, y], [x, ty]]
      }
      case 'VH': {
        const x = sx + fs * (sw - PORT_INSET), y = ty + ft * (th - PORT_INSET)
        return [[x, sy], [x, y], [tx, y]]
      }
      case 'HVH': {
        const y1 = sy + fs * (sh - PORT_INSET), y2 = ty + ft * (th - PORT_INSET)
        const xm = sx + (tx - sx) * frac
        return [[sx, y1], [xm, y1], [xm, y2], [tx, y2]]
      }
      case 'VHV': {
        const x1 = sx + fs * (sw - PORT_INSET), x2 = tx + ft * (tw - PORT_INSET)
        const ym = sy + (ty - sy) * frac
        return [[x1, sy], [x1, ym], [x2, ym], [x2, ty]]
      }
    }
  }

  /**
   * Offset of the far end of arrow `e` along the side where its end `k` attaches,
   * ports in this order do not cross each other next to the box.
   */
  portKey(e: number, k: 0 | 1): number {
    const [a, b] = this.graph.edges[e]!
    const [kind] = ROUTES[this.routes[e]!]!
    const [ax, ay] = this.centers[a]!, [bx, by] = this.centers[b]!
    // source ends of HV and HVH leave horizontally, target ends of VH and HVH enter horizontally
    const alongY = k === 0 ? kind === 'HV' || kind === 'HVH' : kind === 'VH' || kind === 'HVH'
    switch (true) {
      case k === 0 && alongY:
        return by - ay
      case k === 0:
        return bx - ax
      case alongY:
        return ay - by
      default:
        return ax - bx
    }
  }

  private hidden(px: number, py: number, e: number): boolean {
    for (const node of this.graph.edges[e]!) {
      const [x0, y0, x1, y1] = this.boxes[node]!
      if (px > x0 && px < x1 && py > y0 && py < y1) {
        return true
      }
    }
    return false
  }

  /** Segment runs through a box, or along one of its sides closer than MIN_GAP */
  private boxPenalty(s: Segment, node: number): number {
    const [x0, y0, x1, y1] = this.boxes[node]!
    const [a0, a1, s0, s1] = s.horiz ? [y0, y1, x0, x1] : [x0, x1, y0, y1]
    let cost = 0
    if (s.c > a0 && s.c < a1 && s.lo < s1 && s.hi > s0) {
      cost += W_THROUGH
    }
    // hugging is measured against the unshrunk box
    const r0 = a0 - SHRINK, r1 = a1 + SHRINK
    const near = (s.c > r0 - MIN_GAP && s.c <= r0 + SHRINK) || (s.c >= r1 - SHRINK && s.c < r1 + MIN_GAP)
    if (near && Math.min(s.hi, s1 + SHRINK) - Math.max(s.lo, s0 - SHRINK) > MIN_SHARED) {
      cost += W_HUG
    }
    return cost
  }

  /** Cost of arrows K against everything, plus all other arrows against the moved boxes */
  cost(K: ReadonlyArray<number>, moved: ReadonlyArray<number> = []): number {
    const { edges } = this.graph
    const inK = this.inK
    for (const k of K) {
      inK[k] = 1
    }
    let total = 0
    for (const k of K) {
      const polyline = this.polylines[k]!
      total += W_BEND * (polyline.length - 2)
      for (let i = 0; i + 1 < polyline.length; i++) {
        const d = Math.abs(polyline[i]![0] - polyline[i + 1]![0]) + Math.abs(polyline[i]![1] - polyline[i + 1]![1])
        total += W_LEN * d
        if (d > 0.5 && d < MIN_SEGMENT) {
          total += W_JOG
        }
      }
      const [ks, kt] = edges[k]!
      for (const s of this.segments[k]!) {
        for (let e = 0; e < edges.length; e++) {
          if (e === k) {
            continue
          }
          // pairs within K are visited from both sides
          const w = inK[e] ? 0.5 : 1
          for (const t of this.segments[e]!) {
            if (s.horiz !== t.horiz) {
              if (t.c > s.lo && t.c < s.hi && s.c > t.lo && s.c < t.hi) {
                const [px, py] = s.horiz ? [t.c, s.c] : [s.c, t.c]
                if (!this.hidden(px, py, k) && !this.hidden(px, py, e)) {
                  total += W_CROSS * w
                }
              }
              continue
            }
            if (Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) <= MIN_SHARED) {
              continue
            }
            const gap = Math.abs(s.c - t.c)
            if (gap < OVERLAP_GAP) {
              total += W_OVERLAP * w
            } else if (gap < MIN_GAP) {
              total += W_CLOSE * w
            }
          }
        }
        for (let node = 0; node < this.boxes.length; node++) {
          if (node !== ks && node !== kt) {
            total += this.boxPenalty(s, node)
          }
        }
      }
    }
    if (moved.length > 0) {
      for (let e = 0; e < edges.length; e++) {
        if (inK[e]) {
          continue
        }
        const [es, et] = edges[e]!
        for (const s of this.segments[e]!) {
          for (const node of moved) {
            if (node !== es && node !== et) {
              total += this.boxPenalty(s, node)
            }
          }
        }
      }
    }
    for (const k of K) {
      inK[k] = 0
    }
    return total
  }

  /** Deviation of neighbours per side from each side's share of the box perimeter */
  sideCost(): number {
    const [bx0, by0, bx1, by1] = this.slots.box
    const w = bx1 - bx0, h = by1 - by0
    let top = 0, bottom = 0, left = 0, right = 0
    for (const node of this.graph.outer) {
      const [x, y] = this.centers[node]!
      switch (true) {
        case y < by0:
          top++
          break
        case y > by1:
          bottom++
          break
        case x < bx0:
          left++
          break
        default:
          right++
      }
    }
    const n = this.graph.outer.length, perimeter = 2 * (w + h)
    return Math.abs(top - n * w / perimeter) + Math.abs(bottom - n * w / perimeter)
      + Math.abs(left - n * h / perimeter) + Math.abs(right - n * h / perimeter)
  }
}

export function anneal(graph: SurroundGraph, options: AnnealOptions): AnnealResult {
  const rnd = random(options.seed)
  const randInt = (n: number) => Math.floor(rnd() * n)
  const slots = buildSlots(graph, options.aspect, options.spare)
  const st = new SurroundState(graph, slots, rnd, options.outerOrder)
  const { edges } = graph
  const T0 = options.t0 ?? 2, T1 = 0.02
  const nin = slots.inner.length, nout = slots.outer.length
  const movable = [...graph.outer, ...(graph.inner.length > 1 ? graph.inner : [])]
  const accept = (delta: number, T: number) => delta <= 0 || rnd() < Math.exp(-delta / T)

  for (let it = 0; it < options.iterations; it++) {
    const T = T0 * (T1 / T0) ** (it / options.iterations)
    const r = rnd()
    switch (true) {
      // move a box to another slot, swapping with its occupant
      case r < 0.45: {
        if (movable.length === 0) {
          break
        }
        const node = movable[randInt(movable.length)]!
        const from = st.slotOf[node]!
        const to: Slot = from.outer
          ? { outer: true, index: rnd() < 0.8 ? (from.index + randInt(25) - 12 + nout) % nout : randInt(nout) }
          : { outer: false, index: randInt(nin) }
        if (to.index === from.index) {
          break
        }
        const other = st.occupant(to)
        const moved = other === undefined ? [node] : [node, other]
        const K = [...new Set(moved.flatMap(m => st.incident[m]!))]
        const before = st.cost(K, moved) + W_SIDE * st.sideCost()
        const apply = (a: Slot, b: Slot) => {
          st.place(node, b)
          if (other !== undefined) {
            st.place(other, a)
          } else {
            st.free(a)
          }
          st.refresh(K)
        }
        apply(from, to)
        if (!accept(st.cost(K, moved) + W_SIDE * st.sideCost() - before, T)) {
          apply(to, from)
        }
        break
      }
      // change the route shape of one arrow
      case r < 0.85: {
        if (edges.length === 0) {
          break
        }
        const e = randInt(edges.length)
        const old = st.routes[e]!
        const before = st.cost([e])
        st.routes[e] = randInt(ROUTES.length)
        st.refresh([e])
        if (!accept(st.cost([e]) - before, T)) {
          st.routes[e] = old
          st.refresh([e])
        }
        break
      }
      // order the attachment points of a box by where its arrows go
      case r < 0.9: {
        const node = randInt(graph.sizes.length)
        const incident = st.incident[node]!
        if (incident.length < 2) {
          break
        }
        const ends = incident.map(e => [e, edges[e]![0] === node ? 0 : 1] as const)
        const old = ends.map(([e, k]) => st.ports[e]![k])
        const pool = [...old].sort((a, b) => a - b)
        const order = ends.map((end, i) => ({ i, key: st.portKey(...end) })).sort((a, b) => a.key - b.key)
        const set = (values: ReadonlyArray<number>) => {
          ends.forEach(([e, k], i) => {
            st.ports[e]![k] = values[i]!
          })
          st.refresh(incident)
        }
        const sorted = Array.from({ length: ends.length }, () => 0)
        order.forEach(({ i }, rank) => {
          sorted[i] = pool[rank]!
        })
        const before = st.cost(incident)
        set(sorted)
        if (!accept(st.cost(incident) - before, T)) {
          set(old)
        }
        break
      }
      // swap the attachment points of two arrows on the same box
      default: {
        const node = randInt(graph.sizes.length)
        const incident = st.incident[node]!
        if (incident.length < 2) {
          break
        }
        const i = randInt(incident.length)
        const j = (i + 1 + randInt(incident.length - 1)) % incident.length
        const e1 = incident[i]!, e2 = incident[j]!
        const k1 = edges[e1]![0] === node ? 0 : 1, k2 = edges[e2]![0] === node ? 0 : 1
        const swap = () => {
          const p = st.ports[e1]![k1]
          st.ports[e1]![k1] = st.ports[e2]![k2]
          st.ports[e2]![k2] = p
          st.refresh([e1, e2])
        }
        const K = e1 === e2 ? [e1] : [e1, e2]
        const before = st.cost(K)
        swap()
        if (!accept(st.cost(K) - before, T)) {
          swap()
        }
      }
    }
  }
  const cost = st.cost(edges.map((_, e) => e)) + W_SIDE * st.sideCost()
  return { centers: st.centers, polylines: st.polylines, slots, cost }
}
