**# Runbook — Bridge annotation (Phase 0: dataset connection fix)

End-to-end steps to connect the disconnected comparison graph (today: two components,
~355 + ~45 images, 0 crossing comparisons) into a single comparable scale by
collecting a fixed, pre-computed set of **island×mainland** "bridge" comparisons.

Everything is seeded/deterministic and runs on the existing stack (Node scripts +
the existing compare UI + `POST /api/compare`). No scoring-algorithm change.

## Prerequisites

- MongoDB reachable via `MONGODB_URI` (defaults to `mongodb://localhost:27017/elo-rating`).
- Images present and seeded (so `Image.eloRating` is populated — used to bin by quantile).
- A connectivity baseline (optional sanity check):
  ```bash
  npm run analyze:connectivity            # expect: 2 components, 0 cross edges
  ```

## 1. Generate the bridge manifest

Deterministic from `--seed`. Defaults: budget 1000, redundancy 2, quantiles 5,
min-crossings-per-island 8, random-frac 0.15.

```bash
npm run generate:bridge-pairs -- --seed 42
# or with explicit knobs:
node scripts/generate-bridge-pairs.js --seed 42 \
  --budget 1000 --redundancy 2 --quantiles 5 \
  --min-crossings-per-island 8 --random-frac 0.15
```

Writes `data/bridge/bridge-pairs.42.json` (ordered, core-first) and prints a summary
(unique pairs, total annotations, crossings/island, quantile cells, excluded-existing).
The **core** front-loads every island image's required crossings, so even a partial
run connects the graph.

> Run against the **target DB** (its image ObjectIds go into the manifest). For offline
> dev you can pass `--input data/elo-export-<date>/sessions_<date>.json` instead.

## 2. Seed the manifest into the DB

Idempotent — safe to re-run; pairs are unique on the sorted `(aId,bId)`.

```bash
npm run seed:bridge-pairs -- --seed 42
# add --replace to wipe a previously seeded manifest first
```

## 3. Annotate via the existing compare UI

Share one link per annotator (self + 3–5 core people). The `?source=bridge` flag
makes the client pull pairs from the bridge queue and tags every vote `source='bridge'`:

```
https://<host>/?source=bridge&username=<name>
```

- The UI serves bridge pairs **core-first**, records each via the unchanged
  `POST /api/compare`, and advances automatically.
- Each pair is rated up to `targetCount` (= redundancy) times, **preferably by
  different people** (C2) — the queue keeps offering a pair to other annotators
  until its quota is met, and never re-serves a pair within the same session.
- When the queue is exhausted the annotator sees a **"Bridge complete"** screen.

## 4. Monitor progress

```bash
curl -s http://<host>/api/bridge/progress
# { totalPairs, totalTarget, totalDone, remaining, islandImagesConnected }
```

`islandImagesConnected` reaching the island image count (e.g. 45) means every island
image now has at least one rated crossing — the graph is connected.

## 5. Verify connectivity + offset stability

```bash
# Hard gate: exit 0 = single connected component, exit 1 = still split
npm run analyze:connectivity -- --assert-connected

# With offset stability (seeded bootstrap of the former-cohort Elo offset):
node scripts/analyze-connectivity.js --assert-connected --offset --seed 42
```

Acceptance (A2a): **single connected component**. A tight offset CI indicates the two
former cohorts are well tied on one scale.

## 6. Export the single-scale ranking

The server recomputes Elo from all comparisons (now including bridges) on boot and on
each vote. Export the unified ranking:

```bash
curl -s "http://<host>/api/images?format=csv" -o elo-rankings.csv
# or JSON: curl -s http://<host>/api/images -o elo-ratings.json
```

Bridge votes remain tagged `source='bridge'` for later filtering/weighting in Phase 1.

---

**Milestone map:** M1 connectivity toolkit (`scripts/lib/graph.js`,
`analyze-connectivity.js`) · M2 generator (`generate-bridge-pairs.js`) · M3 model +
seed + `GET /api/bridge/{next,progress}` · M4 client `?source=bridge` mode + this runbook.**
