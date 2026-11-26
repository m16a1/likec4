// SPDX-License-Identifier: MIT
//
// Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

import { describe, expect, it } from 'vitest'
import { type ColorizableEdge, colorizeEdges, computeEdgeColors } from './colorize-edges'

function edge(
  id: string,
  points: ReadonlyArray<readonly [number, number]>,
  { source = `${id}-source`, target = `${id}-target` }: { source?: string; target?: string } = {},
): ColorizableEdge {
  return {
    id,
    source,
    target,
    data: { points },
  }
}

function hueOf(color: string): number {
  const match = /oklch\([^ ]+ [^ ]+ ([^)]+)\)/.exec(color)
  if (!match) {
    throw new Error(`Not an oklch color: ${color}`)
  }
  return Number(match[1])
}

function hueDistance(a: number, b: number): number {
  const distance = Math.abs(a - b) % 360
  return distance > 180 ? 360 - distance : distance
}

type TestEdge = ColorizableEdge & { data: { colorizedStroke?: string | undefined } }

function testEdge(
  id: string,
  source: string,
  target: string,
  points: ReadonlyArray<readonly [number, number]>,
): TestEdge {
  return {
    id,
    source,
    target,
    data: { points },
  }
}

describe('computeEdgeColors', () => {
  it('assigns a color to every edge', () => {
    const edges = [
      edge('a', [[0, 0], [100, 0]]),
      edge('b', [[0, 200], [100, 200]]),
      edge('c', [[0, 400], [100, 400]]),
    ]
    const colors = computeEdgeColors(edges)
    expect(colors.size).toBe(edges.length)
    for (const id of ['a', 'b', 'c']) {
      expect(colors.get(id)).toMatch(/^oklch\(/)
    }
  })

  it('gives close parallel edges different and visually distinct colors', () => {
    const colors = computeEdgeColors([
      edge('a', [[0, 0], [300, 0]]),
      edge('b', [[0, 10], [300, 10]]),
    ])
    const first = colors.get('a')!
    const second = colors.get('b')!
    expect(first).not.toBe(second)
    expect(hueDistance(hueOf(first), hueOf(second))).toBeGreaterThan(45)
  })

  it('does not reuse colors for edges connected to the same node', () => {
    const colors = computeEdgeColors([
      edge('a', [[0, 0], [100, 0]], { source: 'hub' }),
      edge('b', [[0, 500], [100, 500]], { source: 'hub' }),
      edge('c', [[0, -500], [100, -500]], { source: 'hub' }),
    ])
    expect(new Set(colors.values()).size).toBe(3)
  })

  it('gives every edge of a small diagram its own color', () => {
    const edges = Array.from(
      { length: 10 },
      (_, index) => edge(`edge-${index}`, [[0, index * 300], [200, index * 300]]),
    )
    const colors = computeEdgeColors(edges)
    expect(new Set(colors.values()).size).toBe(edges.length)
  })

  it('is deterministic', () => {
    const edges = [
      edge('a', [[0, 0], [300, 0]]),
      edge('b', [[0, 10], [300, 10]]),
      edge('c', [[100, -50], [100, 50]]),
    ]
    expect(computeEdgeColors(edges)).toEqual(computeEdgeColors(edges))
  })
})

describe('colorizeEdges', () => {
  it('adds and removes colorizedStroke', () => {
    const edges = [
      testEdge('a', 'a', 'b', [[0, 0], [100, 0]]),
      testEdge('b', 'c', 'd', [[0, 200], [100, 200]]),
    ]

    const colorized = colorizeEdges(edges, true)
    expect(colorized.every(edge => edge.data.colorizedStroke)).toBe(true)
    expect(colorized[0]!.data.colorizedStroke).not.toBe(colorized[1]!.data.colorizedStroke)

    const restored = colorizeEdges(colorized, false)
    expect(restored.every(edge => edge.data.colorizedStroke === undefined)).toBe(true)
  })

  it('returns the same array when nothing changed', () => {
    const edges = [
      testEdge('a', 'a', 'b', [[0, 0], [100, 0]]),
    ]
    const colorized = colorizeEdges(edges, true)
    expect(colorizeEdges(colorized, true)).toBe(colorized)
  })
})
