import type { BBox, XYPoint } from '@likec4/core/geometry'

export interface OrthoMetrics {
  /** Width to height ratio of the drawing */
  readonly widthToHeight: number
  readonly crossings: number
  /** Arrows with at least one crossing */
  readonly crossedArrows: number
  /** Pairs of parallel segments lying on top of each other */
  readonly overlaps: number
  /** Pairs of parallel segments too close to tell apart */
  readonly tooClose: number
  /** Arrow and box pairs where the arrow runs along a box side it does not attach to */
  readonly hugging: number
  /** Arrow and box pairs where the arrow passes through a box it does not attach to */
  readonly through: number
  readonly bends: number
  /** Segments shorter than 20px */
  readonly jogs: number
  /** Segments that are neither horizontal nor vertical */
  readonly diagonal: number
}

interface Arrow {
  readonly points: ReadonlyArray<XYPoint>
  readonly source: number
  readonly target: number
}

type Seg = { arrow: number; horiz: boolean; c: number; lo: number; hi: number }

const OVERLAP_GAP = 3
const MIN_GAP = 24
const MIN_SHARED = 30
const MIN_SEGMENT = 20
const SHRINK = 4

const inside = (b: BBox, x: number, y: number) =>
  x > b.x + SHRINK && x < b.x + b.width - SHRINK && y > b.y + SHRINK && y < b.y + b.height - SHRINK

/**
 * Readability metrics of an orthogonal drawing, same definitions as the `surround` optimiser uses.
 * Crossings inside the boxes an arrow attaches to are not counted.
 */
export function orthoMetrics(arrows: ReadonlyArray<Arrow>, boxes: ReadonlyArray<BBox>): OrthoMetrics {
  const segs: Seg[] = []
  let diagonal = 0, bends = 0, jogs = 0
  arrows.forEach(({ points }, arrow) => {
    bends += Math.max(0, points.length - 2)
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!, b = points[i + 1]!
      const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
      if (d > 0.5 && d < MIN_SEGMENT) {
        jogs++
      }
      switch (true) {
        case d < 0.5:
          break
        case Math.abs(a.y - b.y) < 0.5:
          segs.push({ arrow, horiz: true, c: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) })
          break
        case Math.abs(a.x - b.x) < 0.5:
          segs.push({ arrow, horiz: false, c: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) })
          break
        default:
          diagonal++
      }
    }
  })
  const ends = (arrow: number) => [arrows[arrow]!.source, arrows[arrow]!.target]

  let crossings = 0, overlaps = 0, tooClose = 0
  const crossed = new Set<number>()
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!
    for (let j = i + 1; j < segs.length; j++) {
      const t = segs[j]!
      if (s.arrow === t.arrow) {
        continue
      }
      if (s.horiz !== t.horiz) {
        if (t.c > s.lo && t.c < s.hi && s.c > t.lo && s.c < t.hi) {
          const [x, y] = s.horiz ? [t.c, s.c] : [s.c, t.c]
          const hidden = [...ends(s.arrow), ...ends(t.arrow)].some(n => inside(boxes[n]!, x, y))
          if (!hidden) {
            crossings++
            crossed.add(s.arrow).add(t.arrow)
          }
        }
        continue
      }
      if (Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) <= MIN_SHARED) {
        continue
      }
      const gap = Math.abs(s.c - t.c)
      if (gap < OVERLAP_GAP) {
        overlaps++
      } else if (gap < MIN_GAP) {
        tooClose++
      }
    }
  }

  const throughPairs = new Set<string>(), hugPairs = new Set<string>()
  for (const s of segs) {
    const own = ends(s.arrow)
    boxes.forEach((b, n) => {
      if (own.includes(n)) {
        return
      }
      const [a0, a1, s0, s1] = s.horiz
        ? [b.y, b.y + b.height, b.x, b.x + b.width]
        : [b.x, b.x + b.width, b.y, b.y + b.height]
      if (s.c > a0 + SHRINK && s.c < a1 - SHRINK && s.lo < s1 - SHRINK && s.hi > s0 + SHRINK) {
        throughPairs.add(`${s.arrow}:${n}`)
      }
      const near = (s.c > a0 - MIN_GAP && s.c <= a0 + SHRINK) || (s.c >= a1 - SHRINK && s.c < a1 + MIN_GAP)
      if (near && Math.min(s.hi, s1) - Math.max(s.lo, s0) > MIN_SHARED) {
        hugPairs.add(`${s.arrow}:${n}`)
      }
    })
  }

  const xs = [...boxes.flatMap(b => [b.x, b.x + b.width]), ...arrows.flatMap(a => a.points.map(p => p.x))]
  const ys = [...boxes.flatMap(b => [b.y, b.y + b.height]), ...arrows.flatMap(a => a.points.map(p => p.y))]
  const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys)
  return {
    widthToHeight: Math.round(width / height * 100) / 100,
    crossings,
    crossedArrows: crossed.size,
    overlaps,
    tooClose,
    hugging: hugPairs.size,
    through: throughPairs.size,
    bends,
    jogs,
    diagonal,
  }
}
