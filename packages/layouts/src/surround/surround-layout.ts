import { BBox } from '@likec4/core/geometry'
import type { DiagramEdge, DiagramNode, LayoutedElementView, Point } from '@likec4/core/types'
import { placeEdgeLabels } from '../graphviz/place-edge-label'
import { type SurroundGraph, anneal, buildSlots, innerRingSize, random } from './annealer'
import { capForExtent, compactAxis, compactedExtent } from './compact'
import { circularOrder } from './order'
import { gridRoute, routeScore } from './router'

export interface SurroundLayoutOptions {
  /** Target width to height ratio, defaults to 16:9 */
  readonly aspect?: number
  /** Annealing iterations, defaults to a number scaled to the view size */
  readonly iterations?: number
  readonly seed?: number
  /** Independent annealing runs sharing the iterations, the best one wins */
  readonly restarts?: number
}

/** Padding of the system box around its children; extra on top for the title */
const PADDING = 40
const PADDING_TOP = 60
/** Interior grid cells per child of the system box */
const SPARE = 4
/** Room per arrow along the hub perimeter in views without a system box */
const PORT_SPACING = 36
/** Limit of hub growth, in sizes of the hub as drawn by Graphviz */
const MAX_HUB_SCALE = 12
/** Empty bands between boxes and arrows shrink to at most this */
const COMPACT_GAP = 90
/** Start temperature of annealing from the sketch order: refine it rather than shuffle it away */
const SKETCH_T0 = 0.3
/** Above this many arrows routing on the grid gets slow and no longer pays off */
const MAX_ROUTED_ARROWS = 300

type XY = { x: number; y: number }

/**
 * Re-places a Graphviz-layouted element view so that neighbours surround the system on a frame
 * close to the target aspect, with orthogonal arrows chosen to minimise crossings.
 *
 * Applies to views with at most one system box (a top-level compound with leaf children), all other
 * nodes being top-level leaves and all arrows connecting leaves. Without a compound, the busiest node
 * is the centre. Returns `null` when the view does not have this shape, keeping the Graphviz layout.
 */
export function surroundLayout<V extends LayoutedElementView>(
  view: V,
  options: SurroundLayoutOptions = {},
): V | null {
  const compounds = view.nodes.filter(n => n.children.length > 0)
  const leaves = view.nodes.filter(n => n.children.length === 0)
  const compound = compounds[0]
  const ok = compounds.length <= 1
    && leaves.length >= 2
    && view.edges.length > 0
    && (!compound || compound.parent === null)
    && leaves.every(n => n.parent === null || n.parent === compound?.id)
    && view.edges.every(e => e.source !== e.target)
  if (!ok) {
    return null
  }
  const index = new Map(leaves.map((n, i) => [n.id, i]))
  const edges: Array<readonly [number, number]> = []
  for (const e of view.edges) {
    const s = index.get(e.source), t = index.get(e.target)
    if (s === undefined || t === undefined) {
      return null
    }
    edges.push([s, t])
  }
  const sizes = leaves.map((n): Point => [n.width, n.height])
  let inner = leaves.flatMap((n, i) => compound && n.parent === compound.id ? [i] : [])
  if (inner.length === 0) {
    const degree = leaves.map(() => 0)
    for (const [s, t] of edges) {
      degree[s]!++
      degree[t]!++
    }
    const hub = degree.indexOf(Math.max(...degree))
    inner = [hub]
    // grow the hub until its perimeter fits all its arrows apart
    const [w, h] = sizes[hub]!
    let scale = Math.max(1, degree[hub]! * PORT_SPACING / (2 * (w + h)))
    sizes[hub] = [Math.round(w * scale), Math.round(h * scale)]
    // when every arrow touches the hub, place all neighbours in one ring around it: arrows of
    // an outer ring would have to pass between the boxes of the inner one
    const star = edges.every(([s, t]) => s === hub || t === hub)
    const outer = leaves.flatMap((_, i) => i === hub ? [] : [i])
    while (star && scale < MAX_HUB_SCALE) {
      const slots = buildSlots({ sizes, edges, inner, outer }, options.aspect ?? 16 / 9, SPARE)
      if (innerRingSize({ sizes, edges, inner, outer }, slots) >= outer.length) {
        break
      }
      scale *= 1.1
      sizes[hub] = [Math.round(w * scale), Math.round(h * scale)]
    }
  }
  const graph: SurroundGraph = {
    sizes,
    edges,
    inner,
    outer: leaves.flatMap((_, i) => inner.includes(i) ? [] : [i]),
  }
  // the cost of an iteration grows with the number of arrows, keep the total work bounded
  const iterations = Math.round(Math.min(120_000, Math.max(20_000, Math.min(edges.length * 1_000, 6e6 / edges.length))))
  const restarts = options.restarts ?? 1
  const seed = options.seed ?? 1
  // with a system box, start from the order of neighbours with fewest crossings on a sketch;
  // around a single hub every order is as good
  const outerOrder = compound ? circularOrder(graph, random(seed)) : undefined
  let best = null as ReturnType<typeof anneal> | null
  for (let r = 0; r < restarts; r++) {
    const result = anneal(graph, {
      iterations: Math.round((options.iterations ?? iterations) / restarts),
      seed: seed + r,
      aspect: options.aspect ?? 16 / 9,
      spare: SPARE,
      outerOrder,
      t0: outerOrder ? SKETCH_T0 : undefined,
    })
    if (!best || result.cost < best.cost) {
      best = result
    }
  }
  const { centers } = best!
  // annealing places the boxes, arrows are then routed freely around them, unless the routes
  // found by annealing are better
  let polylines = best!.polylines
  if (edges.length <= MAX_ROUTED_ARROWS) {
    const routed = gridRoute(sizes, centers, edges, { seed })
    if (routeScore(sizes, centers, edges, routed) < routeScore(sizes, centers, edges, polylines)) {
      polylines = routed
    }
  }

  const placedBoxes = sizes.map(([width, height], i): BBox => ({
    x: Math.round(centers[i]![0] - width / 2),
    y: Math.round(centers[i]![1] - height / 2),
    width,
    height,
  }))
  const clipped = edges.map(([s, t], e) =>
    tidy(clip(
      polylines[e]!.map(([x, y]) => ({ x: Math.round(x), y: Math.round(y) })),
      placedBoxes[s]!,
      placedBoxes[t]!,
    ))
  )
  const { boxes, routes: compacted } = compact(placedBoxes, clipped, compound ? inner : [], options.aspect ?? 16 / 9)
  let compoundBox: BBox | null = null
  if (compound) {
    const children = BBox.merge(...inner.map(i => boxes[i]!))
    compoundBox = {
      x: children.x - PADDING,
      y: children.y - PADDING_TOP,
      width: children.width + 2 * PADDING,
      height: children.height + PADDING + PADDING_TOP,
    }
  }
  const routes = view.edges.map((edge, e) => edge.dir === 'back' ? [...compacted[e]!].reverse() : compacted[e]!)

  // shift the drawing to the origin
  const all = BBox.merge(
    ...boxes,
    ...(compoundBox ? [compoundBox] : []),
    ...routes.map(r => BBox.fromPoints(r.map((p): Point => [p.x, p.y]))),
  )
  const dx = -all.x, dy = -all.y
  const moveBox = (b: BBox): BBox => ({ ...b, x: b.x + dx, y: b.y + dy })

  const nodes = view.nodes.map((node): DiagramNode => {
    const i = index.get(node.id)
    const box = i !== undefined ? boxes[i]! : compoundBox
    if (!box) {
      return node
    }
    const moved = moveBox(box)
    return {
      ...node,
      x: moved.x,
      y: moved.y,
      width: moved.width,
      height: moved.height,
      // labels keep their offset from the top-left corner of compounds and from the centre of leaves
      labelBBox: {
        ...node.labelBBox,
        x: node.labelBBox.x - node.x + moved.x + (i !== undefined ? (moved.width - node.width) / 2 : 0),
        y: node.labelBBox.y - node.y + moved.y + (i !== undefined ? (moved.height - node.height) / 2 : 0),
      },
    }
  })
  const layoutedEdges = view.edges.map((edge, e): DiagramEdge => {
    const { controlPoints: _, ...rest } = edge
    return {
      ...rest,
      points: toOrthoSpline(routes[e]!.map(p => [p.x + dx, p.y + dy])),
    }
  })
  const placed = placeEdgeLabels(layoutedEdges, nodes)
  return {
    ...view,
    routing: 'ortho',
    nodes,
    edges: placed,
    bounds: BBox.merge(
      { x: 0, y: 0, width: all.width, height: all.height },
      ...placed.flatMap(edge => edge.labelBBox ? [edge.labelBBox] : []),
    ),
  }
}

const strictlyInside = (b: BBox, { x, y }: XY) => x > b.x && x < b.x + b.width && y > b.y && y < b.y + b.height

/** Point where the segment from `inner` (inside the box) to `outer` leaves the box */
function exitPoint(b: BBox, inner: XY, outer: XY): XY {
  switch (true) {
    case outer.x > b.x + b.width:
      return { x: b.x + b.width, y: inner.y }
    case outer.x < b.x:
      return { x: b.x, y: inner.y }
    case outer.y > b.y + b.height:
      return { x: inner.x, y: b.y + b.height }
    case outer.y < b.y:
      return { x: inner.x, y: b.y }
    default:
      return outer
  }
}

/** Trims a centre-to-centre orthogonal polyline at the borders of its source and target boxes */
function clip(points: XY[], source: BBox, target: BBox): XY[] {
  let start = 0
  while (start + 1 < points.length && strictlyInside(source, points[start + 1]!)) {
    start++
  }
  let end = points.length - 1
  while (end - 1 > start && strictlyInside(target, points[end - 1]!)) {
    end--
  }
  // boxes overlap, nothing to trim
  if (start + 1 > end) {
    return points
  }
  const head = exitPoint(source, points[start]!, points[start + 1]!)
  const tail = exitPoint(target, points[end]!, points[end - 1]!)
  return [head, ...points.slice(start + 1, end), tail]
}

/**
 * Collapses empty bands of the drawing, keeping the order of all coordinates, so the arrangement
 * found by annealing is unchanged. Bands shrink to GAP, then one axis is relaxed towards the aspect.
 */
function compact(
  boxes: ReadonlyArray<BBox>,
  routes: ReadonlyArray<ReadonlyArray<XY>>,
  inner: ReadonlyArray<number>,
  aspect: number,
): { boxes: BBox[]; routes: XY[][] } {
  const xs = [...boxes.flatMap(b => [b.x, b.x + b.width]), ...routes.flatMap(r => r.map(p => p.x))]
  const ys = [...boxes.flatMap(b => [b.y, b.y + b.height]), ...routes.flatMap(r => r.map(p => p.y))]
  if (inner.length > 0) {
    // keep the padding of the system box
    const children = BBox.merge(...inner.map(i => boxes[i]!))
    xs.push(children.x - PADDING, children.x + children.width + PADDING)
    ys.push(children.y - PADDING_TOP, children.y + children.height + PADDING)
  }
  const rigidX = boxes.map(b => [b.x, b.x + b.width] as const)
  const rigidY = boxes.map(b => [b.y, b.y + b.height] as const)
  const maxCap = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  let capX = COMPACT_GAP, capY = COMPACT_GAP
  const width = compactedExtent(xs, rigidX, capX), height = compactedExtent(ys, rigidY, capY)
  if (width / height > aspect) {
    capY = Math.ceil(capForExtent(cap => compactedExtent(ys, rigidY, cap), width / aspect, COMPACT_GAP, maxCap))
  } else {
    capX = Math.ceil(capForExtent(cap => compactedExtent(xs, rigidX, cap), height * aspect, COMPACT_GAP, maxCap))
  }
  const mapX = compactAxis(xs, rigidX, capX), mapY = compactAxis(ys, rigidY, capY)
  return {
    boxes: boxes.map(b => {
      const x = mapX(b.x), y = mapY(b.y)
      return { x, y, width: mapX(b.x + b.width) - x, height: mapY(b.y + b.height) - y }
    }),
    routes: routes.map(r => r.map(p => ({ x: Math.round(mapX(p.x)), y: Math.round(mapY(p.y)) }))),
  }
}

/**
 * Removes jogs shorter than 2px left by rounding, shifting the next segment to stay orthogonal,
 * then drops duplicate and collinear points.
 */
function tidy(points: XY[]): XY[] {
  const p = points.map(pt => ({ ...pt }))
  for (let i = 0; i + 1 < p.length; i++) {
    const a = p[i]!, b = p[i + 1]!, next = p[i + 2]
    const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y)
    switch (true) {
      case dy === 0 && dx > 0 && dx < 2:
        if (next && next.x === b.x) {
          next.x = a.x
        }
        b.x = a.x
        break
      case dx === 0 && dy > 0 && dy < 2:
        if (next && next.y === b.y) {
          next.y = a.y
        }
        b.y = a.y
        break
    }
  }
  const result: XY[] = []
  for (const pt of p) {
    const prev = result.at(-1), before = result.at(-2)
    if (prev && prev.x === pt.x && prev.y === pt.y) {
      continue
    }
    if (prev && before && (before.x === prev.x && prev.x === pt.x || before.y === prev.y && prev.y === pt.y)) {
      result[result.length - 1] = pt
      continue
    }
    result.push(pt)
  }
  return result.length >= 2 ? result : points
}

/**
 * Encodes a polyline as a Graphviz `splines=ortho` spline: one degenerate cubic per segment,
 * which the renderer reads back with `splineToPolyline`.
 */
function toOrthoSpline(points: ReadonlyArray<Point>): DiagramEdge['points'] {
  const result: DiagramEdge['points'] = [points[0]!]
  for (let i = 0; i + 1 < points.length; i++) {
    result.push(points[i]!, points[i + 1]!, points[i + 1]!)
  }
  return result
}
