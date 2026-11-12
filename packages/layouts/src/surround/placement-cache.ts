import type { XY } from './annealer'

export interface SurroundPlacement {
  centers: XY[]
  polylines: XY[][]
}

/**
 * Process-local LRU of completed searches. Only numeric geometry is retained; labels and other view
 * data are rebuilt from the current input. Serialized entries are bounded by their UTF-16 size and
 * decoded on retrieval, so callers cannot mutate a cached placement.
 */
export class PlacementCache {
  private readonly entries = new Map<string, string>()
  private bytes = 0

  constructor(private readonly maxBytes = 4 * 1024 * 1024, private readonly maxEntries = 32) {}

  get(key: string): SurroundPlacement | undefined {
    const value = this.entries.get(key)
    if (value === undefined) {
      return undefined
    }
    this.entries.delete(key)
    this.entries.set(key, value)
    return JSON.parse(value)
  }

  set(key: string, placement: SurroundPlacement): void {
    const value = JSON.stringify(placement)
    const bytes = (key.length + value.length) * 2
    if (bytes > this.maxBytes || this.maxEntries < 1) {
      return
    }
    const old = this.entries.get(key)
    if (old !== undefined) {
      this.bytes -= (key.length + old.length) * 2
      this.entries.delete(key)
    }
    while (this.bytes + bytes > this.maxBytes || this.entries.size >= this.maxEntries) {
      const entry = this.entries.entries().next().value
      if (!entry) {
        break
      }
      this.entries.delete(entry[0])
      this.bytes -= (entry[0].length + entry[1].length) * 2
    }
    this.entries.set(key, value)
    this.bytes += bytes
  }
}
