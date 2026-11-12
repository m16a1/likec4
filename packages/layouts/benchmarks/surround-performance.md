# Surround placement performance

Measured on 2026-11-13 with Node v26.13.0, against commit `3fec5f427`. All inputs are synthetic; no project sources are used. Raw samples and geometry hashes are in [surround-performance.json](./surround-performance.json).

## Retained changes

Replace pairwise checks for relationships between outer nodes with an exact sweep and Fenwick tree: O(V + E log V) instead of O(E²) for that part of scoring. Shared endpoints and duplicate relationships retain their original meaning. The original counter remains for fewer than 64 outer relationships.

The following are medians of three sequential fresh-process samples, alternating before/after order. Search budgets and random seeds are unchanged, and the completed-placement cache is disabled. Timings cover surround placement after Graphviz sizing, including compaction and labels. They exclude parsing, Graphviz, imports, and score collection; these are not full CLI build times.

| Case        | Before (s) | After (s) | Time saved | Readability score |
| ----------- | ---------: | --------: | ---------: | ----------------: |
| big         |      12.60 |     12.54 |       0.5% |             50109 |
| large       |      46.02 |     45.76 |       0.6% |            208636 |
| outer-big   |      15.71 |      5.00 |      68.2% |             52487 |
| outer-large |      66.52 |     13.65 |      79.5% |            234900 |

`big` has 401 nodes and 1,000 relationships; `large` has 801 nodes and 2,000 relationships. The `outer-` cases have the same sizes but more relationships between surrounding elements. The ordinary dense cases exercise the existing sketch scorer. Every before/after sample has the same complete-output SHA-256, aspect ratio, crossings, overlaps, gaps, box intersections, bends, and jogs. The readability score is crossings + 2×overlaps + tooClose + hugging + 6×through; lower is better.

## Rejected experiments

Each proposal was screened separately. Failed proposals were removed before final measurement.

| Proposal                                   |          Big |        Large | Decision |
| ------------------------------------------ | -----------: | -----------: | -------- |
| Compact pair table above the memory cutoff | 16.5% slower | 20.6% slower | Reject   |
| Incremental sketch scoring                 | 53.1% slower | 53.0% slower | Reject   |
| Reuse circle coordinates                   |  0.9% faster |  1.2% slower | Reject   |

The compact-table screen used 2,500 and 4,000 relationships and measured total placement. The other two screens measured circular-order search on the 1,000- and 2,000-relationship cases. Compact-table drawings were identical. Incremental and coordinate trials returned identical circular orders, preserving the input to the unchanged downstream search. These are single-pair screening results, not the final three-round medians.

## Persistent reuse

An opt-in Node.js file cache saves completed numeric placements and their search inputs. Measurements use one first-run miss and then three hits in separate fresh processes:

| Case  | Miss (s) | Median hit (ms) | Readability score |
| ----- | -------: | --------------: | ----------------: |
| big   |    12.45 |           14.76 |             50109 |
| large |    45.50 |           26.78 |            208636 |

Cached output hashes match the uncached drawings. This improves repeated, unchanged placements; no first-run improvement is claimed. Graphviz sizing still runs. Cache errors or corrupt files fall back to recomputation; writes are atomic. Entries include all graph dimensions, ordered endpoints, search options, and a search revision. Labels are rebuilt from the current view. Defaults retain at most 32 files of 4 MiB each, evicting the oldest writes.

Enable it through the layouts API:

```ts
import { GraphvizLayouter } from '@likec4/layouts'
import { FilePlacementCache } from '@likec4/layouts/graphviz/binary'

const layouter = new GraphvizLayouter(undefined, {
  cache: new FilePlacementCache('/path/to/layout-cache'),
})
```

CLI builds continue to use the existing in-memory cache.

## Reproduce

Save a snapshot before editing, save another after, then compare them from the repository root:

```sh
node packages/layouts/scripts/benchmark-surround.mjs snapshot /tmp/surround-before
# Apply the candidate change.
node packages/layouts/scripts/benchmark-surround.mjs snapshot /tmp/surround-after
node packages/layouts/scripts/benchmark-surround.mjs compare /tmp/surround-before /tmp/surround-after big,large,outer-big,outer-large 3 full /tmp/surround-results.json
```

Use `order` in place of `full` to isolate circular ordering, or cases `cap-big,cap-large` to exercise the scoring-table memory fallback. For cross-process persistence, run `worker SNAPSHOT CASE full CACHE_DIR` twice with the same directory; the first run populates the cache and later runs reuse it. The comparator aborts on output changes.

Validation: 107 layouts tests, TypeScript build, lint, formatting, package build, and imports of the built public exports passed.
