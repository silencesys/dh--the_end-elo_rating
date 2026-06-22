#!/usr/bin/env node
'use strict';

/**
 * analyze-connectivity.js — report connectivity & coverage of the comparison graph.
 *
 * Data source:
 *   • MongoDB (default): connects via MONGODB_URI, reuses server/elo.js → loadPairsFromDb().
 *   • --input <export.json>: a legacy export snapshot
 *     (data/elo-export-<date>/sessions_<date>.json, shape sessions[].combinations
 *     with winnerHigherEntropy/loserLowerEntropy + entropyRated) for offline dev.
 *
 * Flags:
 *   --input <path>       read a legacy export instead of the DB (no DB/deps needed)
 *   --json               machine-readable output
 *   --assert-connected   exit 1 if the graph has more than one component (the gate)
 *   --offset             bootstrap the recomputed-Elo offset between the two
 *                        largest components and report its CI width (verifier mode)
 *   --seed <n>           RNG seed for --offset (default 42)
 *   --boot <n>           bootstrap resamples for --offset (default 200)
 *   --replays <n>        Elo replays per fit for --offset (default 3)
 *   -h, --help           usage
 *
 * Examples:
 *   node scripts/analyze-connectivity.js
 *   node scripts/analyze-connectivity.js --input data/elo-export-2026-05-30/sessions_2026-05-30.json
 *   node scripts/analyze-connectivity.js --assert-connected
 *   node scripts/analyze-connectivity.js --offset --seed 7 --json
 */

const fs = require('fs');
const path = require('path');

const {
  buildGraph,
  subgraph,
  connectedComponents,
  degreeStats,
  coverage,
  crossComponentEdges,
  leafNodes,
  COLD_THRESHOLD,
} = require('./lib/graph');
const { mulberry32 } = require('./lib/rng');
const { bootstrapOffset } = require('./lib/offset');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    input: null,
    json: false,
    assertConnected: false,
    offset: false,
    seed: 42,
    boot: 200,
    replays: 3,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--input': opts.input = argv[++i]; break;
      case '--json': opts.json = true; break;
      case '--assert-connected': opts.assertConnected = true; break;
      case '--offset': opts.offset = true; break;
      case '--seed': opts.seed = parseInt(argv[++i], 10); break;
      case '--boot': opts.boot = parseInt(argv[++i], 10); break;
      case '--replays': opts.replays = parseInt(argv[++i], 10); break;
      case '-h':
      case '--help': opts.help = true; break;
      default:
        console.error(`Unknown argument: ${a}`);
        opts.help = true;
    }
  }
  return opts;
}

const HELP = `Usage: node scripts/analyze-connectivity.js [options]

  --input <path>       Read a legacy export (sessions_*.json) instead of MongoDB.
  --json               Emit machine-readable JSON.
  --assert-connected   Exit 1 if the graph has more than one component (gate).
  --offset             Bootstrap recomputed-Elo offset between the two largest
                       components; report CI width (verifier mode).
  --seed <n>           Seed for --offset sampling (default 42).
  --boot <n>           Bootstrap resamples for --offset (default 200).
  --replays <n>        Elo replays per fit for --offset (default 3).
  -h, --help           Show this help.

Data source defaults to MongoDB (MONGODB_URI, or mongodb://localhost:27017/elo-rating).`;

// ---------------------------------------------------------------------------
// env + data loading
// ---------------------------------------------------------------------------

/** Minimal, dependency-free .env loader (the root .env, only filling unset keys). */
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

/** basename of a legacy image reference (url/filename/shelfmark/string). */
function refToId(ref) {
  if (!ref) return null;
  const src = typeof ref === 'string' ? ref : (ref.url ?? ref.filename ?? ref.shelfmark ?? '');
  return path.basename(src) || null;
}

/** Parse a legacy export snapshot into { pairs, imageIds }. */
function loadPairsFromExport(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const sessions = Array.isArray(raw) ? raw : (raw.sessions ?? raw.record?.sessions ?? []);
  const pairs = [];
  const imageIdSet = new Set();
  for (const s of sessions) {
    for (const c of (s.combinations ?? [])) {
      if (!c.entropyRated) continue; // the legacy "rated, not skipped" flag
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

/** Connect to MongoDB and load pairs, reusing the server's helpers. */
async function loadPairsFromDb() {
  loadDotEnv();
  // Lazy-require server modules so --input mode needs no DB deps installed.
  const { connect } = require(path.join(ROOT, 'server', 'db.js'));
  const { loadPairsFromDb: load } = require(path.join(ROOT, 'server', 'elo.js'));
  // connect() logs "Connected to MongoDB" to stdout; keep stdout clean so --json
  // stays parseable by routing that one line to stderr.
  const origLog = console.log;
  console.log = (...a) => console.error(...a);
  try {
    await connect();
  } finally {
    console.log = origLog;
  }
  return load();
}

// ---------------------------------------------------------------------------
// analysis
// ---------------------------------------------------------------------------

function round(x, dp = 4) {
  if (!Number.isFinite(x)) return x;
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

function analyze(pairs, imageIds, opts) {
  const graph = buildGraph(pairs);
  // imageIds may include nodes that never appeared in a non-skipped pair; the
  // graph is built purely from pairs, so its node set is authoritative here.
  const components = connectedComponents(graph);

  let edgeCount = 0;
  for (const d of graph.degree.values()) edgeCount += d;
  edgeCount /= 2; // each comparison increments two endpoints

  const componentReports = components.map((ids, i) => {
    const sub = subgraph(graph, ids);
    return {
      rank: i + 1,
      size: ids.length,
      degree: degreeStats(sub),
      coverage: coverage(sub, ids.length),
    };
  });

  const crossEdges = crossComponentEdges(graph, components);
  const leaves = leafNodes(graph);

  const result = {
    source: opts.input ? `input:${opts.input}` : 'db',
    coldThreshold: COLD_THRESHOLD,
    nodeCount: graph.nodes.size,
    edgeCount,
    uniquePairCount: graph.pairCount.size,
    componentCount: components.length,
    connected: components.length === 1,
    components: componentReports,
    crossComponentEdgeCount: crossEdges.length,
    leafNodeCount: leaves.length,
    leafNodes: leaves,
    offset: null,
  };

  if (opts.offset) {
    if (components.length < 2) {
      result.offset = { available: false, reason: 'fewer than 2 components — nothing to offset' };
    } else {
      const K = parseInt(process.env.ELO_K_FACTOR || '100', 10);
      const rng = mulberry32(opts.seed);
      const boot = bootstrapOffset({
        pairs,
        imageIds: [...graph.nodes],
        groupA: components[0],
        groupB: components[1],
        rng,
        K,
        replays: opts.replays,
        nBoot: opts.boot,
      });
      result.offset = {
        available: true,
        seed: opts.seed,
        K,
        replays: opts.replays,
        nBoot: boot.nBoot,
        ci: boot.ci,
        groupASize: components[0].length,
        groupBSize: components[1].length,
        point: round(boot.point, 2),
        mean: round(boot.mean, 2),
        ciLow: round(boot.ciLow, 2),
        ciHigh: round(boot.ciHigh, 2),
        ciWidth: round(boot.ciWidth, 2),
        // The graph is disconnected whenever this runs (≥2 components). Each
        // component is independently anchored at mean 1500 (Elo updates are
        // zero-sum within a component), so the offset is structurally ≈0 — NOT
        // evidence the cohorts are tied. A real cross-cohort offset needs the
        // connecting bridge comparisons; verify former-cohort ties on the
        // connected graph post-annotation.
        note: 'disconnected graph: offset is structurally ~0, not a tie estimate',
      };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------

function jsonReplacer(_key, value) {
  return typeof value === 'number' ? round(value, 4) : value;
}

function fmt(n, dp = 1) {
  return Number.isFinite(n) ? n.toFixed(dp) : String(n);
}

function printHuman(r) {
  const L = [];
  L.push('Comparison-graph connectivity report');
  L.push(`  source:        ${r.source}`);
  L.push(`  images:        ${r.nodeCount}`);
  L.push(`  comparisons:   ${r.edgeCount} total, ${r.uniquePairCount} unique pairs`);
  L.push(`  components:    ${r.componentCount}${r.connected ? '  (connected ✓)' : '  (DISCONNECTED ✗)'}`);
  L.push('');

  for (const c of r.components) {
    const d = c.degree;
    const cov = c.coverage;
    L.push(`Component #${c.rank} — ${c.size} images`);
    L.push(`  comparisons/image:  mean ${fmt(d.mean)}  median ${fmt(d.median)}  min ${d.min}  max ${d.max}`);
    L.push(`  percentiles:        p10 ${fmt(d.p10)}  p25 ${fmt(d.p25)}  p75 ${fmt(d.p75)}  p90 ${fmt(d.p90)}`);
    L.push(`  Gini: ${fmt(d.gini, 3)}   cold (<${r.coldThreshold} comps): ${d.coldCount}`);
    L.push(`  unique pairs: ${cov.uniquePairs} / ${cov.possible} possible (${fmt(cov.pct, 2)}%)   repeats: ${cov.repeats}  maxRepeat: ${cov.maxRepeat}`);
    L.push('');
  }

  L.push(`Cross-component edges: ${r.crossComponentEdgeCount}`);
  L.push(`Leaf nodes (1 opponent): ${r.leafNodeCount}`);
  if (r.leafNodeCount > 0) {
    const preview = r.leafNodes.slice(0, 10).join(', ');
    L.push(`  ${preview}${r.leafNodeCount > 10 ? `, … (+${r.leafNodeCount - 10} more)` : ''}`);
  }

  if (r.offset) {
    L.push('');
    if (!r.offset.available) {
      L.push(`Offset: n/a — ${r.offset.reason}`);
    } else {
      const o = r.offset;
      L.push(`Recomputed-Elo offset (component #1 − #2): ${fmt(o.point, 2)}`);
      L.push(`  ${Math.round(o.ci * 100)}% bootstrap CI: [${fmt(o.ciLow, 2)}, ${fmt(o.ciHigh, 2)}]  width ${fmt(o.ciWidth, 2)}`);
      L.push(`  (seed=${o.seed}, nBoot=${o.nBoot}, replays=${o.replays}, K=${o.K})`);
      if (o.note) L.push(`  note: ${o.note} — components are independently anchored at 1500.`);
    }
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

  let data;
  if (opts.input) {
    data = loadPairsFromExport(path.resolve(process.cwd(), opts.input));
  } else {
    data = await loadPairsFromDb();
  }

  const report = analyze(data.pairs, data.imageIds, opts);

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, jsonReplacer, 2) + '\n');
  } else {
    printHuman(report);
  }

  if (opts.assertConnected && !report.connected) {
    process.stderr.write(
      `\nassert-connected FAILED: ${report.componentCount} components ` +
        `(${report.components.map((c) => c.size).join(' + ')}).\n`,
    );
    return 1;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('analyze-connectivity error:', err.message);
    process.exit(2);
  });
