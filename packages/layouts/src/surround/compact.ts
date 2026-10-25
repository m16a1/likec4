/**
 * Monotone remapping of one axis of an orthogonal drawing: every gap between consecutive coordinates
 * that no rigid interval (a box) covers shrinks to at most `cap`. The order of coordinates is kept,
 * so crossings, overlaps and arrows through boxes stay exactly as they were.
 */
export function compactAxis(
  coords: ReadonlyArray<number>,
  rigid: ReadonlyArray<readonly [number, number]>,
  cap: number,
): (value: number) => number {
  const sorted = [...new Set(coords)].sort((a, b) => a - b)
  const intervals = mergeIntervals(rigid)
  const mapped = new Map<number, number>()
  let pos = sorted[0] ?? 0
  let k = 0
  sorted.forEach((c, i) => {
    if (i > 0) {
      const prev = sorted[i - 1]!
      while (k < intervals.length && intervals[k]![1] < c) {
        k++
      }
      const interval = intervals[k]
      const covered = interval !== undefined && interval[0] <= prev && c <= interval[1]
      pos += covered ? c - prev : Math.min(c - prev, cap)
    }
    mapped.set(c, pos)
  })
  return value => mapped.get(value) ?? value
}

/** Extent of the axis after `compactAxis` with the given cap */
export function compactedExtent(
  coords: ReadonlyArray<number>,
  rigid: ReadonlyArray<readonly [number, number]>,
  cap: number,
): number {
  const map = compactAxis(coords, rigid, cap)
  const min = Math.min(...coords), max = Math.max(...coords)
  return map(max) - map(min)
}

function mergeIntervals(intervals: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const [lo, hi] of sorted) {
    const last = merged.at(-1)
    if (last && lo <= last[1]) {
      last[1] = Math.max(last[1], hi)
    } else {
      merged.push([lo, hi])
    }
  }
  return merged
}

/**
 * Smallest cap in [min, max] whose extent reaches `target`, or `max` when none does.
 * The extent grows with the cap.
 */
export function capForExtent(extent: (cap: number) => number, target: number, min: number, max: number): number {
  if (extent(min) >= target) {
    return min
  }
  let lo = min, hi = max
  for (let i = 0; i < 30 && hi - lo > 1; i++) {
    const mid = (lo + hi) / 2
    if (extent(mid) >= target) {
      hi = mid
    } else {
      lo = mid
    }
  }
  return hi
}
