import { Builder } from '@likec4/core/builder'
import { BBox, isOrthoSpline, splineToPolyline } from '@likec4/core/geometry'
import type { DiagramNode, LayoutedView } from '@likec4/core/types'
import { describe, it } from 'vitest'
import { GraphvizLayouter } from '../graphviz/GraphvizLayoter'
import { GraphvizWasmAdapter } from '../graphviz/wasm/GraphvizWasmAdapter'
import { orthoMetrics } from './metrics'

function buildModel() {
  return Builder
    .specification({
      elements: {
        system: {},
        service: {},
      },
    })
    .model(({ system, service }, _) =>
      _(
        system('core').with(
          service('api'),
          service('auth'),
          service('cache'),
          service('events'),
          service('ledger'),
          service('reports'),
        ),
        system('partner').with(service('gateway')),
        system('crm'),
        system('billing'),
        system('dwh'),
        system('iam'),
        system('kyc'),
        system('tax'),
        system('bank'),
        system('mdm'),
      )
    )
    .model(({ rel }, _) =>
      _(
        rel('core.api', 'core.auth'),
        rel('core.api', 'core.cache'),
        rel('core.events', 'core.ledger'),
        rel('core.reports', 'core.ledger'),
        rel('partner.gateway', 'core.api'),
        rel('core.api', 'crm', 'sends'),
        rel('core.auth', 'billing', 'sends'),
        rel('core.cache', 'dwh', 'sends'),
        rel('core.events', 'iam', 'sends'),
        rel('core.ledger', 'kyc', 'sends'),
        rel('core.reports', 'tax', 'sends'),
        rel('core.api', 'bank', 'sends'),
        rel('core.auth', 'mdm', 'sends'),
        rel('crm', 'core.events', 'calls'),
        rel('billing', 'core.ledger', 'calls'),
        rel('dwh', 'core.reports', 'calls'),
        rel('iam', 'core.api', 'calls'),
      )
    )
    .views(({ view, viewOf, $include, $rules }, _) =>
      _(
        viewOf('surround', 'core', { placement: 'surround' }, $include('*')),
        viewOf('ranked', 'core', $include('*')),
        view(
          'two-systems',
          { placement: 'surround' },
          $rules($include('core'), $include('core.*'), $include('partner'), $include('partner.*')),
        ),
      )
    )
    .toLikeC4Model()
}

type ViewId = 'surround' | 'ranked' | 'two-systems'

async function layout(id: ViewId): Promise<LayoutedView> {
  const model = buildModel()
  const layouter = new GraphvizLayouter(new GraphvizWasmAdapter())
  const { diagram } = await layouter.layout({ view: model.view(id).$view, styles: model.$styles })
  return diagram
}

const leavesOf = (view: LayoutedView) => view.nodes.filter(n => n.children.length === 0)

function metricsOf(view: LayoutedView) {
  const leaves = leavesOf(view)
  const index = new Map(leaves.map((n, i) => [n.id, i]))
  return orthoMetrics(
    view.edges.map(e => ({
      points: splineToPolyline(e.points),
      source: index.get(e.source) ?? -1,
      target: index.get(e.target) ?? -1,
    })),
    leaves,
  )
}

const contains = (outer: DiagramNode, inner: DiagramNode) =>
  inner.x >= outer.x && inner.y >= outer.y
  && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height

describe('surround placement', () => {
  it('routes every arrow with horizontal and vertical segments only', async ({ expect }) => {
    const view = await layout('surround')
    expect(view.routing).toBe('ortho')
    for (const edge of view.edges) {
      expect.soft(isOrthoSpline(edge.points), edge.id).toBe(true)
    }
    expect(metricsOf(view).diagonal).toBe(0)
  })

  it('keeps services inside the system box and neighbours outside, without overlaps', async ({ expect }) => {
    const view = await layout('surround')
    const system = view.nodes.find(n => n.id === 'core')!
    const leaves = leavesOf(view)
    for (const node of leaves) {
      const inside = contains(system, node)
      expect.soft(inside, node.id).toBe(node.parent === 'core')
      if (node.parent !== 'core') {
        expect.soft(BBox.intersects(system, node), node.id).toBe(false)
      }
    }
    for (const [i, a] of leaves.entries()) {
      for (const b of leaves.slice(i + 1)) {
        expect.soft(BBox.intersects(a, b), `${a.id} and ${b.id}`).toBe(false)
      }
    }
  })

  it('draws a landscape sheet with fewer crossings than ranked placement', async ({ expect }) => {
    const surround = metricsOf(await layout('surround'))
    expect(surround.widthToHeight).toBeGreaterThan(1.2)
    expect(surround.widthToHeight).toBeLessThan(2.4)
    expect(surround).toMatchObject({ overlaps: 0, through: 0 })
    expect(surround.crossings).toBeLessThanOrEqual(2)
  })

  it('is deterministic', async ({ expect }) => {
    const [a, b] = await Promise.all([layout('surround'), layout('surround')])
    expect(a.nodes).toEqual(b.nodes)
    expect(a.edges).toEqual(b.edges)
  })

  it('keeps the Graphviz layout for views it does not apply to', async ({ expect }) => {
    const ranked = await layout('ranked')
    expect(ranked.routing).toBeUndefined()
    // only one system box is supported
    const twoSystems = await layout('two-systems')
    expect(twoSystems.nodes.filter(n => n.children.length > 0)).toHaveLength(2)
    expect(twoSystems.routing).toBeUndefined()
  })
})
