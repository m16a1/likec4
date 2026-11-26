// SPDX-License-Identifier: MIT
//
// Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

import type { Point, XYPoint } from '@likec4/core/types'

/**
 * Minimal shape of an edge needed to compute its color.
 */
export type ColorizableEdge = {
  id: string
  source: string
  target: string
  data: {
    points?: ReadonlyArray<Point | XYPoint> | null | undefined
    controlPoints?: ReadonlyArray<XYPoint> | null | undefined
  }
}

type Segment = readonly [from: XYPoint, to: XYPoint]

type EdgeGeometry = {
  id: string
  segments: Segment[]
}

/**
 * Edges that are closer than this distance (in diagram coordinates) are considered
 * neighbors and never receive the same color.
 */
const PROXIMITY_DISTANCE = 48

/**
 * Step used to sample edges when looking for nearby edges.
 */
const SAMPLE_STEP = 12

/**
 * Size of a spatial hash cell. Chosen so two samples closer than the proximity
 * distance always land in the same or adjacent cells.
 */
const CELL_SIZE = PROXIMITY_DISTANCE + SAMPLE_STEP

/**
 * Lightness levels alternate with the color index, so edges with adjacent hues
 * stay distinguishable (especially in dense diagrams).
 */
const LIGHTNESS_LEVELS = [0.6, 0.72] as const
const CHROMA = 0.16
const HUE_OFFSET = 12

/**
 * Palette indices are spread over the hue wheel with the golden angle, so
 * consecutive indices (the ones most often used by neighbors) are far apart.
 */
const GOLDEN_ANGLE = 137.508
const PALETTE_SIZE = 48
const HUE_SEPARATION_STEPS = [72, 48, 30, 16, 0] as const

function hueOf(index: number): number {
  return (HUE_OFFSET + index * GOLDEN_ANGLE) % 360
}

function hueDistance(a: number, b: number): number {
  const distance = Math.abs(a - b) % 360
  return distance > 180 ? 360 - distance : distance
}

function toPoint(point: Point | XYPoint): XYPoint {
  return 'x' in point ? { x: point.x, y: point.y } : { x: point[0], y: point[1] }
}

function toSegments(points: ReadonlyArray<Point | XYPoint> | null | undefined): Segment[] {
  if (!points || points.length < 2) {
    return []
  }
  const segments: Segment[] = []
  let previous = toPoint(points[0]!)
  for (let i = 1; i < points.length; i++) {
    const next = toPoint(points[i]!)
    if (previous.x !== next.x || previous.y !== next.y) {
      segments.push([previous, next])
    }
    previous = next
  }
  return segments
}

function buildGeometry(edge: ColorizableEdge): EdgeGeometry {
  return {
    id: edge.id,
    // Control points (when set) define the actual routed path, so include them too.
    segments: [
      ...toSegments(edge.data.points),
      ...toSegments(edge.data.controlPoints),
    ],
  }
}

function pointSegmentDistance(point: XYPoint, [from, to]: Segment): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared))
  const closestX = from.x + dx * t
  const closestY = from.y + dy * t
  return Math.hypot(point.x - closestX, point.y - closestY)
}

function orientation(a: XYPoint, b: XYPoint, c: XYPoint): number {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y)
}

function isOnSegment(a: XYPoint, b: XYPoint, c: XYPoint): boolean {
  return Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x)
    && Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y)
}

function segmentsIntersect([a, b]: Segment, [c, d]: Segment): boolean {
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)
  if (Math.sign(o1) !== Math.sign(o2) && Math.sign(o3) !== Math.sign(o4)) {
    return true
  }
  return (o1 === 0 && isOnSegment(a, c, b))
    || (o2 === 0 && isOnSegment(a, d, b))
    || (o3 === 0 && isOnSegment(c, a, d))
    || (o4 === 0 && isOnSegment(c, b, d))
}

function segmentsDistance(a: Segment, b: Segment): number {
  if (segmentsIntersect(a, b)) {
    return 0
  }
  return Math.min(
    pointSegmentDistance(a[0], b),
    pointSegmentDistance(a[1], b),
    pointSegmentDistance(b[0], a),
    pointSegmentDistance(b[1], a),
  )
}

function trackEdgeSamples(edge: EdgeGeometry, buckets: Map<string, Set<string>>): void {
  const insert = (x: number, y: number) => {
    const key = `${Math.floor(x / CELL_SIZE)}:${Math.floor(y / CELL_SIZE)}`
    let ids = buckets.get(key)
    if (!ids) {
      buckets.set(key, ids = new Set())
    }
    ids.add(edge.id)
  }

  for (const [from, to] of edge.segments) {
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    const steps = Math.max(1, Math.ceil(length / SAMPLE_STEP))
    for (let step = 0; step <= steps; step++) {
      const t = step / steps
      insert(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)
    }
  }
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`
}

/**
 * Collects edges that should not share a color: edges connected to the same node
 * or geometrically close to each other.
 */
function collectConflicts(
  edges: ReadonlyArray<ColorizableEdge>,
  geometries: ReadonlyArray<EdgeGeometry>,
): Set<string> {
  const conflicts = new Set<string>()

  const addConflict = (a: string, b: string) => {
    if (a !== b) {
      conflicts.add(pairKey(a, b))
    }
  }

  // Edges that meet at a node are visually adjacent, even if they fan out.
  const edgesByNode = new Map<string, Set<string>>()
  for (const edge of edges) {
    for (const node of new Set([edge.source, edge.target])) {
      let ids = edgesByNode.get(node)
      if (!ids) {
        edgesByNode.set(node, ids = new Set())
      }
      ids.add(edge.id)
    }
  }
  for (const ids of edgesByNode.values()) {
    const list = [...ids]
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        addConflict(list[i]!, list[j]!)
      }
    }
  }

  // Find geometrically close edges with a spatial hash of sampled points.
  const buckets = new Map<string, Set<string>>()
  for (const geometry of geometries) {
    trackEdgeSamples(geometry, buckets)
  }

  const geometryById = new Map(geometries.map(geometry => [geometry.id, geometry]))
  const candidates = new Set<string>()
  for (const [key, ids] of buckets) {
    const [cellX, cellY] = key.split(':').map(Number)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighbor = buckets.get(`${cellX! + dx}:${cellY! + dy}`)
        if (!neighbor) {
          continue
        }
        for (const a of ids) {
          for (const b of neighbor) {
            if (a !== b) {
              candidates.add(pairKey(a, b))
            }
          }
        }
      }
    }
  }

  for (const pair of candidates) {
    const [a, b] = pair.split('\u0000') as [string, string]
    const first = geometryById.get(a)
    const second = geometryById.get(b)
    if (!first || !second || first.segments.length === 0 || second.segments.length === 0) {
      continue
    }
    const distance = first.segments.reduce(
      (min, firstSegment) =>
        second.segments.reduce(
          (innerMin, secondSegment) => Math.min(innerMin, segmentsDistance(firstSegment, secondSegment)),
          min,
        ),
      Infinity,
    )
    if (distance <= PROXIMITY_DISTANCE) {
      addConflict(a, b)
    }
  }

  return conflicts
}

/**
 * Picks the first palette color that is not used by a neighbor. Prefers colors
 * that are not used anywhere yet, and colors with a visibly different hue than
 * all neighbor colors.
 */
function pickColor(neighborColors: Set<number> | undefined, globallyUsed: Set<number>): number {
  const neighbors = neighborColors ?? new Set<number>()
  const neighborHues = [...neighbors].map(hueOf)

  for (const preferUnused of [true, false]) {
    for (const minHueDistance of HUE_SEPARATION_STEPS) {
      for (let index = 0; index < PALETTE_SIZE; index++) {
        if (neighbors.has(index)) {
          continue
        }
        if (preferUnused && globallyUsed.has(index)) {
          continue
        }
        if (
          minHueDistance > 0
          && neighborHues.some(hue => hueDistance(hue, hueOf(index)) < minHueDistance)
        ) {
          continue
        }
        return index
      }
    }
  }

  // Dense diagrams can exhaust the palette; fall back to any free index.
  for (let index = PALETTE_SIZE;; index++) {
    if (!neighbors.has(index)) {
      return index
    }
  }
}

/**
 * DSATUR graph coloring. Returns a color index for each edge id.
 */
function colorEdges(edges: ReadonlyArray<ColorizableEdge>, conflicts: Set<string>): Map<string, number> {
  const ids = edges.map(edge => edge.id)
  const adjacency = new Map<string, Set<string>>(ids.map(id => [id, new Set<string>()]))
  for (const pair of conflicts) {
    const [a, b] = pair.split('\u0000') as [string, string]
    adjacency.get(a)?.add(b)
    adjacency.get(b)?.add(a)
  }

  const colors = new Map<string, number>()
  const neighborColors = new Map<string, Set<number>>()
  const globalsUsed = new Set<number>()
  const uncolored = new Set(ids)

  while (uncolored.size > 0) {
    // DSATUR: pick the edge with the most differently colored neighbors,
    // breaking ties by degree and then by id for deterministic results.
    let selected: string | undefined
    let selectedSaturation = -1
    let selectedDegree = -1
    for (const id of uncolored) {
      const saturation = neighborColors.get(id)?.size ?? 0
      const degree = adjacency.get(id)!.size
      if (
        saturation > selectedSaturation
        || (saturation === selectedSaturation && degree > selectedDegree)
        || (saturation === selectedSaturation && degree === selectedDegree && (!selected || id < selected))
      ) {
        selected = id
        selectedSaturation = saturation
        selectedDegree = degree
      }
    }

    const id = selected!
    const color = pickColor(neighborColors.get(id), globalsUsed)
    colors.set(id, color)
    globalsUsed.add(color)

    for (const neighbor of adjacency.get(id)!) {
      if (!uncolored.has(neighbor)) {
        continue
      }
      let used = neighborColors.get(neighbor)
      if (!used) {
        neighborColors.set(neighbor, used = new Set())
      }
      used.add(color)
    }
    uncolored.delete(id)
  }

  return colors
}

/**
 * Builds the actual CSS color for a color index.
 */
function toCssColor(colorIndex: number): string {
  const lightness = LIGHTNESS_LEVELS[colorIndex % LIGHTNESS_LEVELS.length]
  return `oklch(${lightness} ${CHROMA} ${hueOf(colorIndex).toFixed(1)})`
}

/**
 * Computes a distinct color for every edge, making sure that edges which are
 * close to each other (or connected to the same node) receive different colors.
 */
export function computeEdgeColors(edges: ReadonlyArray<ColorizableEdge>): ReadonlyMap<string, string> {
  if (edges.length === 0) {
    return new Map()
  }

  const geometries = edges.map(buildGeometry)
  const conflicts = collectConflicts(edges, geometries)
  const colorIndexes = colorEdges(edges, conflicts)

  const result = new Map<string, string>()
  for (const [id, colorIndex] of colorIndexes) {
    result.set(id, toCssColor(colorIndex))
  }
  return result
}

/**
 * Adds (or removes) the per-edge stroke color in the edge data.
 * Returns the same array reference when nothing changed.
 */
export function colorizeEdges<E extends ColorizableEdge & { data: { colorizedStroke?: string | undefined } }>(
  edges: E[],
  enabled: boolean,
): E[] {
  const colors = enabled ? computeEdgeColors(edges) : null
  let changed = false

  const result = edges.map((edge): E => {
    const nextColor = colors?.get(edge.id)
    if (edge.data.colorizedStroke === nextColor) {
      return edge
    }
    changed = true
    return {
      ...edge,
      data: {
        ...edge.data,
        colorizedStroke: nextColor,
      },
    }
  })

  return changed ? result : edges
}
