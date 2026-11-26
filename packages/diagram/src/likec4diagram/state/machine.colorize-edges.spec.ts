// SPDX-License-Identifier: MIT
//
// Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

import type { LayoutedElementView } from '@likec4/core/types'
import { scalar } from '@likec4/core/types'
import { describe, expect, it } from 'vitest'
import { createActor, fromCallback } from 'xstate'
import { DefaultFeatures } from '../../context/DiagramFeatures'
import type { XYFlowInstance, XYStoreApi } from '../../hooks/useXYFlow'
import { diagramMachine } from './machine'

const view = {
  _type: 'element',
  _stage: 'layouted',
  id: scalar.ViewId('colorize'),
  title: 'Colorize',
  description: null,
  tags: null,
  links: null,
  hash: 'colorize',
  autoLayout: { direction: 'TB' },
  nodes: [{
    id: scalar.NodeId('client'),
    parent: null,
    children: [],
    inEdges: [],
    outEdges: [scalar.EdgeId('client-to-server')],
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    labelBBox: { x: 0, y: 0, width: 100, height: 24 },
    kind: 'component',
    modelRef: scalar.Fqn('client'),
    title: 'Client',
    description: null,
    technology: null,
    color: 'primary',
    shape: 'rectangle',
    style: {},
    level: 0,
    tags: [],
  }, {
    id: scalar.NodeId('server'),
    parent: null,
    children: [],
    inEdges: [scalar.EdgeId('client-to-server')],
    outEdges: [],
    x: 0,
    y: 300,
    width: 200,
    height: 100,
    labelBBox: { x: 0, y: 0, width: 100, height: 24 },
    kind: 'component',
    modelRef: scalar.Fqn('server'),
    title: 'Server',
    description: null,
    technology: null,
    color: 'secondary',
    shape: 'rectangle',
    style: {},
    level: 0,
    tags: [],
  }],
  edges: [{
    id: scalar.EdgeId('client-to-server'),
    parent: null,
    source: scalar.NodeId('client'),
    target: scalar.NodeId('server'),
    label: 'Requests',
    technology: null,
    relations: [],
    color: 'gray',
    line: 'solid',
    points: [[100, 100], [100, 300]],
  }],
  bounds: { x: 0, y: 0, width: 200, height: 400 },
} satisfies LayoutedElementView

function createTestActor(features = DefaultFeatures) {
  const actor = createActor(
    diagramMachine.provide({
      actors: {
        mediaPrint: fromCallback(() => () => {}),
        hotkey: fromCallback(() => () => {}),
      },
    }),
    {
      input: {
        view,
        xystore: {
          getState: () => ({
            width: 800,
            height: 600,
            transform: [0, 0, 1] as [number, number, number],
            nodeLookup: new Map(),
          }),
          setState: () => {},
          subscribe: () => () => {},
        } as unknown as XYStoreApi,
        zoomable: true,
        pannable: true,
        nodesDraggable: false,
        nodesSelectable: false,
        fitViewPadding: {},
        where: null,
        features,
      },
    },
  )
  actor.start()
  actor.send({
    type: 'xyflow.init',
    instance: { getViewport: () => ({ x: 0, y: 0, zoom: 1 }) } as XYFlowInstance,
  })
  actor.send({ type: 'update.view', view, source: 'external' })
  return actor
}

describe('colorize edges', () => {
  it('adds colors on toggle and removes them on the second toggle', () => {
    const actor = createTestActor()

    expect(actor.getSnapshot().context.xyedges.every(edge => edge.data.colorizedStroke === undefined)).toBe(true)

    actor.send({ type: 'toggle.feature', feature: 'ColorizeEdges' })
    const colorized = actor.getSnapshot().context.xyedges
    expect(colorized).toHaveLength(1)
    expect(colorized[0]!.data.colorizedStroke).toMatch(/^oklch\(/)

    actor.send({ type: 'toggle.feature', feature: 'ColorizeEdges' })
    expect(actor.getSnapshot().context.xyedges[0]!.data.colorizedStroke).toBeUndefined()

    actor.stop()
  })

  it('applies colors when the feature is enabled by default', () => {
    const actor = createTestActor({
      ...DefaultFeatures,
      enableColorizeEdges: true,
    })

    expect(actor.getSnapshot().context.xyedges[0]!.data.colorizedStroke).toMatch(/^oklch\(/)
    expect(actor.getSnapshot().context.toggledFeatures.enableColorizeEdges).toBeUndefined()

    actor.stop()
  })
})
