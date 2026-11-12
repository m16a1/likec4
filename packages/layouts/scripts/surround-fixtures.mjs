/** Deterministic synthetic inputs after Graphviz sizing, with no project data. */
export function surroundFixture(name) {
  let seed = 418
  const random = () => {
    seed |= 0
    seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
  const large = name.includes('large')
  const ni = large ? 320 : 160, no = large ? 480 : 240
  const count = name.startsWith('cap') ? (large ? 4000 : 2500) : (large ? 2000 : 1000)
  const outerHeavy = name.startsWith('outer'), local = name.startsWith('local')
  const edges = [], used = new Set()
  const add = (s, t) => {
    const key = `${s}:${t}`
    if (s !== t && !used.has(key)) {
      used.add(key)
      edges.push([s, t])
    }
  }
  for (let i = 0; i < no; i++) add(i % ni, ni + i)
  while (edges.length < count) {
    const r = random()
    if (outerHeavy && r < 0.8) add(ni + Math.floor(random() * no), ni + Math.floor(random() * no))
    else if (!local && !outerHeavy && r < 0.15) add(Math.floor(random() * ni), Math.floor(random() * ni))
    else add(Math.floor(random() * ni), ni + Math.floor(random() * no))
  }
  const graph = {
    sizes: Array.from({ length: ni + no }, () => [320, 180]),
    edges,
    inner: Array.from({ length: ni }, (_, i) => i),
    outer: Array.from({ length: no }, (_, i) => ni + i),
  }
  const nodes = [
    {
      id: 'focus',
      children: graph.inner.map(i => `n${i}`),
      parent: null,
      x: 0,
      y: 0,
      width: 1000,
      height: 800,
      labelBBox: { x: 0, y: 0, width: 100, height: 20 },
    },
    ...graph.sizes.map(([width, height], i) => ({
      id: `n${i}`,
      parent: i < ni ? 'focus' : null,
      children: [],
      x: 0,
      y: 0,
      width,
      height,
      labelBBox: { x: 0, y: 0, width: 100, height: 20 },
    })),
  ]
  return {
    graph,
    view: {
      id: name,
      nodes,
      edges: edges.map(([s, t], i) => ({
        id: `e${i}`,
        source: `n${s}`,
        target: `n${t}`,
        points: [[0, 0], [0, 0]],
        labelBBox: null,
      })),
      bounds: { x: 0, y: 0, width: 1000, height: 800 },
    },
  }
}
