import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { SurroundPlacement, SurroundPlacementCache } from '../../surround/placement-cache'

const PREFIX = 'surround-v1-'
const MAX_FILE_BYTES = 4 * 1024 * 1024

const point = (value: unknown): value is readonly [number, number] =>
  Array.isArray(value) && value.length === 2 && value.every(v => typeof v === 'number' && Number.isFinite(v))

function placement(value: unknown): value is SurroundPlacement {
  if (typeof value !== 'object' || value === null || !('centers' in value) || !('polylines' in value)) return false
  return Array.isArray(value.centers) && value.centers.every(point)
    && Array.isArray(value.polylines)
    && value.polylines.every(line => Array.isArray(line) && line.length >= 2 && line.every(point))
}

/**
 * Opt-in disk storage for completed surround searches. Cache errors fall back to recomputation.
 * Pass as `new GraphvizLayouter(port, { cache: new FilePlacementCache(directory) })`.
 * At most 32 files of 4 MiB each are retained by default; only numeric geometry and search inputs are stored.
 */
export class FilePlacementCache implements SurroundPlacementCache {
  constructor(private readonly directory: string, private readonly maxEntries = 32) {}

  /** Read a matching, valid placement; unavailable or corrupt entries are cache misses. */
  get(key: string): SurroundPlacement | undefined {
    try {
      const file = this.file(key)
      if (statSync(file).size > MAX_FILE_BYTES) return undefined
      const entry: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (
        typeof entry !== 'object' || entry === null || !('key' in entry) || entry.key !== key
        || !('placement' in entry) || !placement(entry.placement)
      ) return undefined
      return entry.placement
    } catch {
      return undefined
    }
  }

  /** Write atomically and evict the oldest writes above the entry limit. */
  set(key: string, value: SurroundPlacement): void {
    let temporary: string | undefined
    try {
      if (this.maxEntries < 1) return
      const serialized = JSON.stringify({ key, placement: value })
      if (Buffer.byteLength(serialized) > MAX_FILE_BYTES) return
      mkdirSync(this.directory, { recursive: true })
      const file = this.file(key)
      temporary = `${file}.${randomUUID()}.tmp`
      writeFileSync(temporary, serialized, { mode: 0o600, flag: 'wx' })
      renameSync(temporary, file)
      temporary = undefined
      const entries = readdirSync(this.directory)
        .filter(name => /^surround-v1-[a-f0-9]{64}\.json$/.test(name))
        .map(name => ({ name, time: statSync(join(this.directory, name)).mtimeMs }))
        .sort((a, b) => b.time - a.time || Number(b.name === basename(file)) - Number(a.name === basename(file)))
      for (const entry of entries.slice(this.maxEntries)) unlinkSync(join(this.directory, entry.name))
    } catch {
      // Persistence must not prevent a layout from being produced.
    } finally {
      if (temporary) {
        try {
          unlinkSync(temporary)
        } catch { /* Already removed or unavailable. */ }
      }
    }
  }

  private file(key: string): string {
    return join(this.directory, `${PREFIX}${createHash('sha256').update(key).digest('hex')}.json`)
  }
}
