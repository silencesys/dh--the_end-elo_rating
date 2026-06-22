#!/usr/bin/env node
'use strict';

/**
 * generate-bridge-pairs.js — deterministic island×mainland bridge manifest (P0-M2).
 *
 * The comparison graph is split into a large "mainland" component and one or more
 * smaller "island" components with zero crossing comparisons. This generator emits
 * a fixed, seeded list of island×mainland pairs that — once annotated — connect the
 * graph into a single component. It front-loads a connectivity-critical CORE (every
 * island image gets >= k distinct mainland opponents) so that even a partially
 * completed run still connects, then weaves additional quantile-matched, range-
 * spanning, and random crossings for a robust cross-cohort offset.
 *
 * Within a component the *relative* Elo is valid (only the cross-component offset is
 * broken), so we bin each component's images by current Elo quantile.
 *
 * Data source (same convention as M1):
 *   • MongoDB (default): pairs from sessions; per-image Elo + filename from Image.
 *   • --input <sessions.json>: a legacy export snapshot for offline dev (Elo taken
 *     from a sibling elo-ratings.json if present, else recomputed from the pairs).
 *
 * Flags:
 *   --budget <n>                  max total annotations (Sum of targetCount)   [1000]
 *   --redundancy <n>              ratings per pair (targetCount)               [2]
 *   --quantiles <n>               Elo bins per component                       [5]
 *   --min-crossings-per-island <n>  guaranteed mainland opponents per island img [8]
 *   --random-frac <f>             fraction of unique pairs that are random      [0.15]
 *   --seed <n>                    RNG seed (drives everything)                  [42]
 *   --input <path>               read a legacy export instead of MongoDB
 *   --dry-run                    compute + print summary, do not write the file
 *   -h, --help
 *
 * Output:
 *   data/bridge/bridge-pairs.<seed>.json — ordered array of
 *     { aId, bId, aFilename, bFilename, band, targetCount }  (core-first, then weave)
 */

const fs = require('fs');
const path = require('path');

const { buildGraph, connectedComponents, pairKey, splitKey } = require('./lib/graph');
const { mulberry32, seededShuffle } = require('./lib/rng');
const { recomputeEloSeeded } = require('./lib/offset');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const o = {
    budget: 1000,
    redundancy: 2,
    quantiles: 5,
    minCrossings: 8,
    randomFrac: 0.15,
    seed: 42,
    input: null,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--budget': o.budget = parseInt(argv[++i], 10); break;
      case '--redundancy': o.redundancy = parseInt(argv[++i], 10); break;
      case '--quantiles': o.quantiles = parseInt(argv[++i], 10); break;
      case '--min-crossings-per-island': o.minCrossings = parseInt(argv[++i], 10); break;
      case '--random-frac': o.randomFrac = parseFloat(argv[++i]); break;
      case '--seed': o.seed = parseInt(argv[++i], 10); break;
      case '--input': o.input = argv[++i]; break;
      case '--dry-run': o.dryRun = true; break;
      case '-h':
      case '--help': o.help = true; break;
      default:
        console.error(`Unknown argument: ${a}`);
        o.help = true;
    }
  }
  return o;
}

const HELP = `Usage: node scripts/generate-bridge-pairs.js [options]

  --budget <n>                     Max total annotations (sum of targetCount) [1000]
  --redundancy <n>                 Ratings per pair (targetCount)             [2]
  --quantiles <n>                  Elo bins per component                     [5]
  --min-crossings-per-island <n>   Guaranteed mainland opponents per island   [8]
  --random-frac <f>                Fraction of unique pairs that are random    [0.15]
  --seed <n>                       RNG seed (drives everything)               [42]
  --input <path>                   Read a legacy export instead of MongoDB.
  --dry-run                        Compute + summarise, do not write the file.
  -h, --help                       Show this help.

Writes data/bridge/bridge-pairs.<seed>.json (ordered, core-first).`;

// ---------------------------------------------------------------------------
// env + data loading
// ---------------------------------------------------------------------------

function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key in process.env) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

function refToId(ref) {
  if (!ref) return null;
  const src = typeof ref === 'string' ? ref : (ref.url ?? ref.filename ?? ref.shelfmark ?? '');
  return path.basename(src) || null;
}

function loadPairsFromExport(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const sessions = Array.isArray(raw) ? raw : (raw.sessions ?? raw.record?.sessions ?? []);
  const pairs = [];
  const imageIdSet = new Set();
  for (const s of sessions) {
    for (const c of (s.combinations ?? [])) {
      if (!c.entropyRated) continue;
      const w = refToId(c.winnerHigherEntropy);
      const l = refToId(c.loserLowerEntropy);
      if (!w || !l) continue;
      pairs.push([w, l]);
      imageIdSet.add(w);
      imageIdSet.add(l);
    }
  }
  return { pairs, imageIds: [...imageIdSet] };
}

/** Sibling elo-ratings.json (filename -> eloRating), or null if absent. */
function loadEloSibling(sessionsPath) {
  const ratingsPath = path.join(path.dirname(sessionsPath), 'elo-ratings.json');
  if (!fs.existsSync(ratingsPath)) return null;
  const arr = JSON.parse(fs.readFileSync(ratingsPath, 'utf8'));
  const m = new Map();
  for (const r of arr) if (r && r.filename != null) m.set(r.filename, r.eloRating ?? 1500);
  return m;
}

function loadOffline(inputPath, seed) {
  const resolved = path.resolve(process.cwd(), inputPath);
  const { pairs, imageIds } = loadPairsFromExport(resolved);
  const filenameById = new Map(imageIds.map((id) => [id, id])); // offline: id IS the filename
  let eloById = loadEloSibling(resolved);
  if (!eloById) {
    // Fallback: recompute relative Elo from the pairs (own RNG so the generator
    // stream stays identical whether or not this branch runs).
    eloById = recomputeEloSeeded(pairs, imageIds, { K: 100, replays: 20, rng: mulberry32(seed + 1) });
  }
  return { source: `input:${inputPath}`, pairs, imageIds, eloById, filenameById };
}

async function loadFromDb() {
  loadDotEnv();
  const { connect } = require(path.join(ROOT, 'server', 'db.js'));
  const { loadPairsFromDb } = require(path.join(ROOT, 'server', 'elo.js'));
  const Image = require(path.join(ROOT, 'server', 'models', 'Image'));

  const origLog = console.log;
  console.log = (...a) => console.error(...a); // keep stdout clean
  try {
    await connect();
  } finally {
    console.log = origLog;
  }

  const { pairs, imageIds } = await loadPairsFromDb();
  const imgs = await Image.find({}, { filename: 1, eloRating: 1 }).lean();
  const eloById = new Map();
  const filenameById = new Map();
  for (const im of imgs) {
    const id = String(im._id);
    eloById.set(id, im.eloRating ?? 1500);
    filenameById.set(id, im.filename ?? id);
  }
  return { source: 'db', pairs, imageIds, eloById, filenameById };
}

// ---------------------------------------------------------------------------
// quantiles
// ---------------------------------------------------------------------------

/** Stable comparator by (Elo asc, id asc) so binning is order-independent. */
function byEloThenId(eloById) {
  return (a, b) => {
    const ea = eloById.get(a) ?? 1500;
    const eb = eloById.get(b) ?? 1500;
    if (ea !== eb) return ea - eb;
    return a < b ? -1 : a > b ? 1 : 0;
  };
}

/** Rank-based even binning into Q quantiles. Returns { qOf:Map, bins:Array<id[]> }. */
function assignQuantiles(ids, eloById, Q) {
  const sorted = ids.slice().sort(byEloThenId(eloById));
  const n = sorted.length;
  const qOf = new Map();
  const bins = Array.from({ length: Q }, () => []);
  for (let r = 0; r < n; r++) {
    let q = n > 0 ? Math.floor((r * Q) / n) : 0;
    if (q >= Q) q = Q - 1;
    qOf.set(sorted[r], q);
    bins[q].push(sorted[r]);
  }
  return { qOf, bins };
}

// ---------------------------------------------------------------------------
// generation (pure: deterministic given (data, params, seed))
// ---------------------------------------------------------------------------

function generate(data, params, seed) {
  const { pairs, eloById, filenameById } = data;
  const { budget, redundancy, quantiles: Q, minCrossings, randomFrac } = params;

  const rng = mulberry32(seed);
  const capUnique = Math.floor(budget / redundancy);

  const graph = buildGraph(pairs);
  const components = connectedComponents(graph);
  if (components.length < 2) {
    throw new Error(`graph already has ${components.length} component(s); nothing to bridge`);
  }

  const mainland = components[0];
  const islands = components.slice(1);
  const mainlandSet = new Set(mainland);
  const islandSet = new Set(islands.flat());

  // Pre-existing rated pairs to exclude. Count how many already cross island×mainland
  // (should be 0 pre-annotation — that is the disconnection we are fixing).
  const existing = new Set(graph.pairCount.keys());
  let excludedExisting = 0;
  for (const key of existing) {
    const [a, b] = splitKey(key);
    if ((islandSet.has(a) && mainlandSet.has(b)) || (mainlandSet.has(a) && islandSet.has(b))) {
      excludedExisting++;
    }
  }

  // Mainland quantiles; shuffle each bin once (seeded) for opponent variety, then
  // draw round-robin so opponents spread across many distinct mainland images.
  const mainQ = assignQuantiles(mainland, eloById, Q);
  const mainBins = mainQ.bins.map((bin) => seededShuffle(bin, rng));
  const mainPtr = new Array(Q).fill(0);
  const mainlandSorted = mainland.slice().sort(byEloThenId(eloById)); // for random band

  // Island-image quantiles (within each island).
  const islandQOf = new Map();
  for (const isl of islands) {
    const q = assignQuantiles(isl, eloById, Q);
    for (const [id, qi] of q.qOf) islandQOf.set(id, qi);
  }

  const chosen = new Set();
  const manifest = []; // { islandId, mainId, band, qi, qm }

  function pickFromQuantile(i, q) {
    const bin = mainBins[q];
    const n = bin.length;
    for (let step = 0; step < n; step++) {
      const idx = (mainPtr[q] + step) % n;
      const m = bin[idx];
      const key = pairKey(i, m);
      if (existing.has(key) || chosen.has(key)) continue;
      mainPtr[q] = (idx + 1) % n;
      return m;
    }
    return null;
  }

  /** Pick an opponent preferring quantile `preferred`, falling through the rest. */
  function pick(i, preferred) {
    const order = [preferred];
    for (let q = 0; q < Q; q++) if (q !== preferred) order.push(q);
    for (const q of order) {
      const m = pickFromQuantile(i, q);
      if (m) return m;
    }
    return null;
  }

  function emit(islandId, mainId) {
    const qi = islandQOf.get(islandId) ?? 0;
    const qm = mainQ.qOf.get(mainId) ?? 0;
    const band = qm === qi ? 'matched' : 'spanning';
    chosen.add(pairKey(islandId, mainId));
    manifest.push({ islandId, mainId, band, qi, qm });
  }

  const islandImagesOrdered = islands.flat().slice().sort(byEloThenId(eloById));

  // ---- Phase A: connectivity-critical core (emitted first) ----
  for (const i of islandImagesOrdered) {
    const qi = islandQOf.get(i) ?? 0;
    // Target-quantile sequence: matched, mirror (spanning), then a full sweep —
    // gives each island image a couple of same-quantile and several spanning ties.
    const seq = [qi, Q - 1 - qi];
    for (let q = 0; q < Q; q++) seq.push(q);
    let got = 0;
    let si = 0;
    while (got < minCrossings && manifest.length < capUnique) {
      const m = pick(i, seq[si % seq.length]);
      si++;
      if (m === null) break; // mainland exhausted for i (not expected at real scale)
      emit(i, m);
      got++;
    }
  }
  const coreCount = manifest.length;

  // ---- Phase B: weave up to the unique-pair cap ----
  const remaining = capUnique - manifest.length;
  if (remaining > 0) {
    const randomTarget = Math.min(remaining, Math.round(randomFrac * capUnique));
    const structuredTarget = remaining - randomTarget;

    // Structured: alternate matched / mirror-spanning across island images.
    let added = 0;
    let idx = 0;
    const maxIdx = islandImagesOrdered.length * (Q + 4) + structuredTarget;
    while (added < structuredTarget && idx < maxIdx) {
      const i = islandImagesOrdered[idx % islandImagesOrdered.length];
      const qi = islandQOf.get(i) ?? 0;
      const preferred = added % 2 === 0 ? qi : Q - 1 - qi;
      idx++;
      const m = pick(i, preferred);
      if (m === null) continue;
      emit(i, m);
      added++;
    }

    // Random: uniform island×mainland crossings (deterministic via seeded rng).
    let radded = 0;
    let guard = 0;
    const guardMax = randomTarget * 200 + 1000;
    while (radded < randomTarget && guard < guardMax && manifest.length < capUnique) {
      guard++;
      const i = islandImagesOrdered[Math.floor(rng() * islandImagesOrdered.length)];
      const m = mainlandSorted[Math.floor(rng() * mainlandSorted.length)];
      const key = pairKey(i, m);
      if (existing.has(key) || chosen.has(key)) continue;
      chosen.add(key);
      manifest.push({ islandId: i, mainId: m, band: 'random', qi: islandQOf.get(i) ?? 0, qm: mainQ.qOf.get(m) ?? 0 });
      radded++;
    }
  }

  // ---- Materialise output with deterministic L/R randomisation ----
  const out = manifest.map(({ islandId, mainId, band }) => {
    const swap = rng() < 0.5;
    const aId = swap ? mainId : islandId;
    const bId = swap ? islandId : mainId;
    return {
      aId,
      bId,
      aFilename: filenameById.get(aId) ?? aId,
      bFilename: filenameById.get(bId) ?? bId,
      band,
      targetCount: redundancy,
    };
  });

  // ---- Stats ----
  const oppByIsland = new Map();
  for (const i of islandImagesOrdered) oppByIsland.set(i, new Set());
  for (const { islandId, mainId } of manifest) oppByIsland.get(islandId).add(mainId);
  const crossingCounts = [...oppByIsland.values()].map((s) => s.size);
  const minCross = crossingCounts.length ? Math.min(...crossingCounts) : 0;
  const meanCross = crossingCounts.length
    ? crossingCounts.reduce((a, b) => a + b, 0) / crossingCounts.length
    : 0;

  const cells = new Set();
  const bandCounts = { matched: 0, spanning: 0, random: 0 };
  for (const e of manifest) {
    cells.add(`${e.qi},${e.qm}`);
    bandCounts[e.band] = (bandCounts[e.band] || 0) + 1;
  }

  const stats = {
    source: data.source,
    seed,
    params,
    componentSizes: components.map((c) => c.length),
    mainlandSize: mainland.length,
    islandCount: islands.length,
    islandImageCount: islandImagesOrdered.length,
    capUnique,
    uniquePairs: out.length,
    coreCount,
    weaveCount: out.length - coreCount,
    totalAnnotations: out.length * redundancy,
    bandCounts,
    crossings: { min: minCross, mean: meanCross },
    quantileCellsFilled: cells.size,
    quantileCellsTotal: Q * Q,
    excludedExisting,
    // Dry-run connectivity proof: existing edges + core bridges -> one component.
    corePairs: manifest.slice(0, coreCount).map(({ islandId, mainId }) => [islandId, mainId]),
  };

  return { manifest: out, stats };
}

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------

function printSummary(stats, outPath) {
  const s = stats;
  const L = [];
  L.push('Bridge-pair manifest');
  L.push(`  source:            ${s.source}`);
  L.push(`  seed:              ${s.seed}`);
  L.push(`  components:        ${s.componentSizes.join(' + ')}  (mainland ${s.mainlandSize}, ${s.islandCount} island(s), ${s.islandImageCount} island images)`);
  L.push(`  budget/redundancy: ${s.params.budget} / ${s.params.redundancy}  -> cap ${s.capUnique} unique pairs`);
  L.push('');
  L.push(`  unique pairs:      ${s.uniquePairs}  (core ${s.coreCount}, weave ${s.weaveCount})`);
  L.push(`  total annotations: ${s.totalAnnotations}  (= unique x ${s.params.redundancy}, budget ${s.params.budget})`);
  L.push(`  bands:             matched ${s.bandCounts.matched}, spanning ${s.bandCounts.spanning}, random ${s.bandCounts.random}`);
  L.push(`  crossings/island:  min ${s.crossings.min}  mean ${s.crossings.mean.toFixed(1)}  (target >= ${s.params.minCrossings})`);
  L.push(`  quantile cells:    ${s.quantileCellsFilled} / ${s.quantileCellsTotal} filled`);
  L.push(`  excluded existing: ${s.excludedExisting}  (island x mainland pairs already rated)`);
  if (outPath) {
    L.push('');
    L.push(`  written: ${outPath}`);
  }
  process.stdout.write(L.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP + '\n');
    return 0;
  }

  const params = {
    budget: opts.budget,
    redundancy: opts.redundancy,
    quantiles: opts.quantiles,
    minCrossings: opts.minCrossings,
    randomFrac: opts.randomFrac,
  };

  const data = opts.input ? loadOffline(opts.input, opts.seed) : await loadFromDb();
  const { manifest, stats } = generate(data, params, opts.seed);

  let outPath = null;
  if (!opts.dryRun) {
    const dir = path.join(ROOT, 'data', 'bridge');
    fs.mkdirSync(dir, { recursive: true });
    outPath = path.join(dir, `bridge-pairs.${opts.seed}.json`);
    fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  }

  printSummary(stats, outPath ? path.relative(ROOT, outPath) : null);
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('generate-bridge-pairs error:', err.message);
      process.exit(2);
    });
}

module.exports = { generate, assignQuantiles };
