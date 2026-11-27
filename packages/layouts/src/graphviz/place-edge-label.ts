import {
  BBox,
  placeLabelsAlongRoutes,
  polylineToSegments,
  segmentIntersectsBox,
  splineToPolyline,
} from '@likec4/core/geometry'
import type { DiagramEdge, DiagramNode } from '@likec4/core/types'
import { isCompound } from './utils'

type EdgeGeometry = Pick<DiagramEdge, 'id' | 'points' | 'labelBBox'>
type NodeGeometry = Pick<DiagramNode, 'x' | 'y' | 'width' | 'height' | 'children'>

const isLeaf = (node: NodeGeometry) => !isCompound(node)

const routeSegments = (edge: EdgeGeometry) => polylineToSegments(splineToPolyline(edge.points))

/**
 * Places the labels of orthogonal edges beside straight runs, avoiding leaf nodes, other labels and
 * routes. Compound boxes are not obstacles because routes run inside them.
 */
export function placeEdgeLabels<E extends EdgeGeometry>(
  edges: ReadonlyArray<E>,
  nodes: ReadonlyArray<NodeGeometry>,
): E[] {
  const positions = placeLabelsAlongRoutes(
    edges.map(edge => ({
      id: edge.id,
      segments: routeSegments(edge),
      labelBBox: edge.labelBBox ?? null,
    })),
    nodes.filter(isLeaf),
  )
  return edges.map(edge => {
    const labelBBox = positions.get(edge.id)
    return labelBBox ? { ...edge, labelBBox } : edge
  })
}

/**
 * Hides labels that cover a leaf node or the route of another relationship.
 * Labels of dynamic views (steps) are not affected by the caller.
 */
export function hideObstructedEdgeLabels<E extends EdgeGeometry>(
  edges: ReadonlyArray<E>,
  nodes: ReadonlyArray<NodeGeometry>,
): E[] {
  const leaves = nodes.filter(isLeaf)
  const routes = edges.map(edge => ({
    id: edge.id,
    segments: routeSegments(edge),
    bbox: BBox.fromPoints(edge.points),
  }))
  return edges.map(edge => {
    const labelBBox = edge.labelBBox
    if (!labelBBox) {
      return edge
    }
    const coversNode = leaves.some(node => BBox.intersects(labelBBox, node))
    const coversRoute = routes.some(route =>
      route.id !== edge.id &&
      BBox.intersects(labelBBox, route.bbox) &&
      route.segments.some(segment => segmentIntersectsBox(segment, labelBBox))
    )
    return coversNode || coversRoute ? { ...edge, labelBBox: null } : edge
  })
}
