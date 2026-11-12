/** Bounds of a rectangle, including its boundary. */
export type Bounds = readonly [number, number, number, number]

/**
 * Mutable broad-phase grid. Cells store item bitsets, so queries return unique IDs in ascending
 * order without sorting. An item may occupy several rectangles (the segments of one arrow).
 * Remove all old rectangles before inserting its new ones.
 */
export class SpatialIndex {
  private readonly columns: number
  private readonly rows: number
  private readonly step: number
  private readonly words: number
  private readonly cells: Uint32Array
  private readonly matches: Uint32Array
  private readonly result: number[] = []

  constructor(count: number, private readonly bounds: Bounds) {
    const width = bounds[2] - bounds[0], height = bounds[3] - bounds[1]
    this.step = Math.max(256, width / 32, height / 32)
    this.columns = Math.floor(width / this.step) + 1
    this.rows = Math.floor(height / this.step) + 1
    this.words = Math.ceil(count / 32)
    this.cells = new Uint32Array(this.columns * this.rows * this.words)
    this.matches = new Uint32Array(this.words)
  }

  update(id: number, x0: number, y0: number, x1: number, y1: number, insert: boolean): void {
    const left = this.column(x0), right = this.column(x1)
    const top = this.row(y0), bottom = this.row(y1)
    const word = id >>> 5, bit = 1 << (id & 31)
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const offset = (y * this.columns + x) * this.words + word
        this.cells[offset] = insert ? this.cells[offset]! | bit : this.cells[offset]! & ~bit
      }
    }
  }

  clearQuery(): void {
    this.matches.fill(0)
  }

  include(x0: number, y0: number, x1: number, y1: number): void {
    const left = this.column(x0), right = this.column(x1)
    const top = this.row(y0), bottom = this.row(y1)
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const offset = (y * this.columns + x) * this.words
        for (let w = 0; w < this.words; w++) {
          this.matches[w]! |= this.cells[offset + w]!
        }
      }
    }
  }

  /** Reused until the next call. */
  values(): ReadonlyArray<number> {
    this.result.length = 0
    for (let w = 0; w < this.words; w++) {
      let bits = this.matches[w]!
      while (bits !== 0) {
        const bit = 31 - Math.clz32(bits & -bits)
        this.result.push(w * 32 + bit)
        bits &= bits - 1
      }
    }
    return this.result
  }

  private column(x: number): number {
    return Math.max(0, Math.min(this.columns - 1, Math.floor((x - this.bounds[0]) / this.step)))
  }

  private row(y: number): number {
    return Math.max(0, Math.min(this.rows - 1, Math.floor((y - this.bounds[1]) / this.step)))
  }
}
