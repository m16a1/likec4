import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { surroundFixture } from './surround-fixtures.mjs'

// Snapshot before editing, snapshot after, then compare the two directories. Each sample runs alone
// in a fresh Node process. Measured work is surround placement after sizing, excluding metrics and imports.
const self = fileURLToPath(import.meta.url)
const packageRoot = resolve(dirname(self), '..')
const [command, ...args] = process.argv.slice(2)

if (command === 'snapshot') {
  const destination = resolve(args[0])
  mkdirSync(destination, { recursive: true })
  if (!existsSync(`${destination}/node_modules`)) {
    symlinkSync(`${packageRoot}/node_modules`, `${destination}/node_modules`)
  }
  const files = [
    ...readdirSync(`${packageRoot}/src/surround`)
      .filter(n => n.endsWith('.ts') && !n.endsWith('.spec.ts')).map(n => `surround/${n}`),
    'graphviz/place-edge-label.ts',
    'graphviz/utils.ts',
    'graphviz/binary/FilePlacementCache.ts',
  ]
  for (const name of files) {
    if (!existsSync(`${packageRoot}/src/${name}`)) continue
    const output = `${destination}/${name.replace(/\.ts$/, '.mjs')}`
    mkdirSync(dirname(output), { recursive: true })
    const js = ts.transpileModule(readFileSync(`${packageRoot}/src/${name}`, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText.replace(/(from\s+['"])(\.[^'"]+)(['"])/g, '$1$2.mjs$3')
    writeFileSync(output, js)
  }
} else if (command === 'worker') {
  const [snapshot, name, mode = 'full', cacheDirectory] = args
  const load = name => import(pathToFileURL(resolve(snapshot, `${name}.mjs`)).href)
  const { graph, view } = surroundFixture(name)
  const { circularOrder } = await load('surround/order')
  const { random } = await load('surround/annealer')
  const { surroundLayout } = await load('surround/surround-layout')
  const { orthoMetrics } = await load('surround/metrics')
  const { splineToPolyline } = await import('@likec4/core/geometry')
  let cache = false
  if (cacheDirectory) {
    const { FilePlacementCache } = await load('graphviz/binary/FilePlacementCache')
    cache = new FilePlacementCache(resolve(cacheDirectory, name))
  }
  const start = performance.now()
  const result = mode === 'order' ? circularOrder(graph, random(1)) : surroundLayout(view, { cache })
  const ms = performance.now() - start
  let metrics, score
  if (mode !== 'order') {
    const leaves = result.nodes.filter(n => !n.children.length)
    const ids = new Map(leaves.map((n, i) => [n.id, i]))
    metrics = orthoMetrics(
      result.edges.map(e => ({
        source: ids.get(e.source),
        target: ids.get(e.target),
        points: splineToPolyline(e.points),
      })),
      leaves,
    )
    score = metrics.crossings + 2 * metrics.overlaps + metrics.tooClose + metrics.hugging + 6 * metrics.through
  }
  console.log(JSON.stringify({
    snapshot,
    name,
    mode,
    ms,
    score,
    metrics,
    hash: createHash('sha256').update(JSON.stringify(result)).digest('hex'),
    peakRssKiB: process.resourceUsage().maxRSS,
  }))
} else if (command === 'compare') {
  const [before, after, names = 'big,large,outer-big,outer-large', rounds = '3', mode = 'full', output] = args
  const records = []
  for (let round = 0; round < Number(rounds); round++) {
    for (const name of names.split(',')) {
      const pair = []
      for (const snapshot of round % 2 ? [after, before] : [before, after]) {
        const child = spawnSync(process.execPath, [self, 'worker', snapshot, name, mode], {
          encoding: 'utf8',
          timeout: 900_000,
        })
        if (child.status !== 0 || !child.stdout.trim()) throw new Error(child.stderr || String(child.error))
        const record = { ...JSON.parse(child.stdout.trim().split('\n').at(-1)), round }
        records.push(record)
        pair.push(record)
        console.log(JSON.stringify(record))
        if (output) writeFileSync(output, JSON.stringify(records, null, 2))
      }
      if (pair[0].hash !== pair[1].hash) throw new Error(`Geometry changed for ${name}`)
    }
  }
  for (const name of names.split(',')) {
    const median = snapshot => {
      const times = records.filter(r => r.snapshot === snapshot && r.name === name).map(r => r.ms).sort((a, b) => a - b)
      return times[Math.floor(times.length / 2)]
    }
    const b = median(before), a = median(after)
    console.log(JSON.stringify({ name, beforeMs: b, afterMs: a, savedPercent: 100 * (b - a) / b }))
  }
} else {
  throw new Error(
    'Usage: benchmark-surround.mjs snapshot DIR | compare BEFORE AFTER [CASES] [ROUNDS] [full|order] [JSON] | worker SNAPSHOT CASE [full|order] [CACHE_DIR]',
  )
}
