interface Usage {
  readonly edgeH: Int16Array
  readonly edgeV: Int16Array
  readonly passH: Int16Array
  readonly passV: Int16Array
  readonly bend: Int16Array
}

interface Entry {
  readonly path: number[]
  readonly nodes: Int32Array
  readonly usage: Int16Array
}

/**
 * Reuse a path search only when every congestion value read by its previous execution is unchanged.
 * All initial states, estimates and heap operations then replay identically. Changed values outside
 * that execution's footprint cannot affect the result. Wide searches stop recording and run uncached.
 */
export class RouteCache {
  private readonly entries: Array<Entry | undefined>
  private readonly disabled: Uint8Array
  private readonly seen: Uint32Array
  private readonly nodes: number[] = []
  private readonly maxNodes: number
  private generation = 0
  private arrow = 0

  constructor(
    arrows: number,
    private readonly columns: number,
    private readonly usage: Usage,
    maxBytes = 2 * 1024 * 1024,
  ) {
    this.entries = Array.from({ length: arrows })
    this.disabled = new Uint8Array(arrows)
    this.seen = new Uint32Array(usage.edgeH.length)
    // Four edge counters plus three node counters (14 bytes), and the grid index (4 bytes).
    this.maxNodes = Math.floor(maxBytes / Math.max(1, arrows) / 18)
  }

  get(e: number): number[] | undefined {
    const entry = this.entries[e]
    if (!entry) {
      return undefined
    }
    const { edgeH, edgeV, passH, passV, bend } = this.usage
    for (let i = 0; i < entry.nodes.length; i++) {
      const v = entry.nodes[i]!, k = i * 7
      if (
        entry.usage[k] !== edgeH[v] || entry.usage[k + 1] !== (edgeH[v - 1] ?? 0)
        || entry.usage[k + 2] !== edgeV[v] || entry.usage[k + 3] !== (edgeV[v - this.columns] ?? 0)
        || entry.usage[k + 4] !== passH[v] || entry.usage[k + 5] !== passV[v] || entry.usage[k + 6] !== bend[v]
      ) {
        return undefined
      }
    }
    return entry.path
  }

  begin(e: number): boolean {
    if (this.disabled[e] || this.maxNodes === 0) {
      return false
    }
    this.arrow = e
    this.nodes.length = 0
    this.generation = (this.generation + 1) >>> 0
    if (this.generation === 0) {
      this.seen.fill(0)
      this.generation = 1
    }
    return true
  }

  observe(v: number): boolean {
    if (this.seen[v] !== this.generation) {
      this.seen[v] = this.generation
      if (this.nodes.length === this.maxNodes) {
        this.disabled[this.arrow] = 1
        this.entries[this.arrow] = undefined
        this.nodes.length = 0
        return false
      }
      this.nodes.push(v)
    }
    return true
  }

  set(e: number, path: number[]): void {
    const values = new Int16Array(this.nodes.length * 7)
    const { edgeH, edgeV, passH, passV, bend } = this.usage
    for (let i = 0; i < this.nodes.length; i++) {
      const v = this.nodes[i]!, k = i * 7
      values[k] = edgeH[v]!
      values[k + 1] = edgeH[v - 1] ?? 0
      values[k + 2] = edgeV[v]!
      values[k + 3] = edgeV[v - this.columns] ?? 0
      values[k + 4] = passH[v]!
      values[k + 5] = passV[v]!
      values[k + 6] = bend[v]!
    }
    this.entries[e] = { path, nodes: new Int32Array(this.nodes), usage: values }
  }
}
