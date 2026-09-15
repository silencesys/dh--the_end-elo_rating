'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { generate } = require('./generate-bridge-pairs');
const { buildGraph, connectedComponents, pairKey } = require('./lib/graph');

// --- builders ---------------------------------------------------------------

/** A connected component as a chain c0-c1-...-c(n-1), with spread Elo. */
function chainComponent(prefix, n, eloBase, eloStep) {
  const ids = Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  const pairs = [];
  for (let i = 0; i < n - 1; i++) pairs.push([ids[i], ids[i + 1]]);
  const elo = new Map(ids.map((id, i) => [id, eloBase + i * eloStep]));
  return { ids, pairs, elo };
}

/** Assemble a multi-component dataset (first = mainland, rest = islands). */
function dataset(components) {
  const pairs = [];
  const eloById = new Map();
  const imageIds = [];
  for (const c of components) {
    pairs.push(...c.pairs);
    for (const id of c.ids) imageIds.push(id);
    for (const [id, e] of c.elo) eloById.set(id, e);
  }
  const filenameById = new Map(imageIds.map((id) => [id, `${id}.jpg`]));
  return { source: 'test', pairs, imageIds, eloById, filenameById };
}

const PARAMS = { budget: 1000, redundancy: 2, quantiles: 5, minCrossings: 8, randomFrac: 0.15 };

// mainland 30, island 12, no crossings
const MAINLAND = chainComponent('m', 30, 1000, 10);
const ISLAND = chainComponent('s', 12, 1400, 5);
const DATA = dataset([MAINLAND, ISLAND]);
const ISLAND_SET = new Set(ISLAND.ids);
const MAINLAND_SET = new Set(MAINLAND.ids);

/** For a manifest entry, return {island, main} by membership (L/R is randomised). */
function classify(entry, islandSet, mainlandSet) {
  const aI = islandSet.has(entry.aId);
  const bI = islandSet.has(entry.bId);
  const aM = mainlandSet.has(entry.aId);
  const bM = mainlandSet.has(entry.bId);
  if (aI && bM) return { island: entry.aId, main: entry.bId };
  if (bI && aM) return { island: entry.bId, main: entry.aId };
  return null; // not a clean island×mainland pair
}

// --- tests ------------------------------------------------------------------

test('deterministic: same seed => byte-identical manifest', () => {
  const a = generate(DATA, PARAMS, 7).manifest;
  const b = generate(DATA, PARAMS, 7).manifest;
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('different seeds => different manifests', () => {
  const a = generate(DATA, PARAMS, 1).manifest;
  const b = generate(DATA, PARAMS, 2).manifest;
  assert.notEqual(JSON.stringify(a), JSON.stringify(b));
});

test('every island image gets >= minCrossings distinct mainland opponents', () => {
  const { manifest } = generate(DATA, PARAMS, 7);
  const opp = new Map(ISLAND.ids.map((id) => [id, new Set()]));
  for (const e of manifest) {
    const c = classify(e, ISLAND_SET, MAINLAND_SET);
    assert.ok(c, `entry ${e.aId}/${e.bId} is not island×mainland`);
    opp.get(c.island).add(c.main);
  }
  for (const id of ISLAND.ids) {
    assert.ok(opp.get(id).size >= PARAMS.minCrossings, `${id} has ${opp.get(id).size} < ${PARAMS.minCrossings}`);
  }
});

test('zero island×island, no duplicates, no pre-existing pairs', () => {
  const { manifest } = generate(DATA, PARAMS, 7);
  const existing = new Set(buildGraph(DATA.pairs).pairCount.keys());
  const seen = new Set();
  for (const e of manifest) {
    // every pair is exactly one island + one mainland endpoint
    assert.ok(classify(e, ISLAND_SET, MAINLAND_SET), 'island×island or malformed pair leaked');
    const key = pairKey(e.aId, e.bId);
    assert.ok(!seen.has(key), `duplicate pair ${key}`);
    seen.add(key);
    assert.ok(!existing.has(key), `pre-existing pair re-emitted ${key}`);
  }
});

test('budget respected: unique <= cap and Sum(targetCount) <= budget', () => {
  const { manifest, stats } = generate(DATA, PARAMS, 7);
  assert.ok(manifest.length <= stats.capUnique);
  const total = manifest.reduce((s, e) => s + e.targetCount, 0);
  assert.ok(total <= PARAMS.budget, `Sum targetCount ${total} > budget ${PARAMS.budget}`);
  assert.equal(total, stats.totalAnnotations);
  for (const e of manifest) assert.equal(e.targetCount, PARAMS.redundancy);
});

test('dry-run: existing edges + core pairs => one connected component', () => {
  const { stats } = generate(DATA, PARAMS, 7);
  const combined = DATA.pairs.concat(stats.corePairs);
  const comps = connectedComponents(buildGraph(combined));
  assert.equal(comps.length, 1, `expected 1 component, got ${comps.map((c) => c.length)}`);
});

test('generalises to >= 2 islands; still connects and never island×island', () => {
  const island2 = chainComponent('t', 6, 1700, 8);
  const data = dataset([MAINLAND, ISLAND, island2]);
  const islandSet = new Set([...ISLAND.ids, ...island2.ids]);
  const mainSet = new Set(MAINLAND.ids);

  const { manifest, stats } = generate(data, PARAMS, 11);
  assert.equal(stats.islandCount, 2);

  const opp = new Map([...islandSet].map((id) => [id, new Set()]));
  for (const e of manifest) {
    const c = classify(e, islandSet, mainSet);
    assert.ok(c, 'island×island leaked across the two islands');
    opp.get(c.island).add(c.main);
  }
  for (const id of islandSet) assert.ok(opp.get(id).size >= PARAMS.minCrossings);

  const comps = connectedComponents(buildGraph(data.pairs.concat(stats.corePairs)));
  assert.equal(comps.length, 1);
});

// --- integration against the real offline export ----------------------------

const EXPORT = path.join(__dirname, '..', 'data', 'elo-export-2026-05-30', 'sessions_2026-05-30.json');

test('real export: 45-island core connects the graph; acceptance holds', { skip: !fs.existsSync(EXPORT) }, () => {
  // Load the same way the CLI's offline path does.
  const { generate: gen } = require('./generate-bridge-pairs');
  const raw = JSON.parse(fs.readFileSync(EXPORT, 'utf8'));
  const sessions = Array.isArray(raw) ? raw : (raw.sessions ?? []);
  const pairs = [];
  const ids = new Set();
  for (const s of sessions) {
    for (const c of (s.combinations ?? [])) {
      if (!c.entropyRated) continue;
      const w = c.winnerHigherEntropy && path.basename(c.winnerHigherEntropy.url ?? '');
      const l = c.loserLowerEntropy && path.basename(c.loserLowerEntropy.url ?? '');
      if (!w || !l) continue;
      pairs.push([w, l]);
      ids.add(w);
      ids.add(l);
    }
  }
  const ratings = JSON.parse(
    fs.readFileSync(path.join(path.dirname(EXPORT), 'elo-ratings.json'), 'utf8'),
  );
  const eloById = new Map(ratings.map((r) => [r.filename, r.eloRating]));
  const filenameById = new Map([...ids].map((id) => [id, id]));
  const data = { source: 'export', pairs, imageIds: [...ids], eloById, filenameById };

  const components = connectedComponents(buildGraph(pairs));
  assert.deepEqual(components.map((c) => c.length), [355, 45]);

  const { manifest, stats } = gen(data, PARAMS, 42);
  assert.equal(stats.excludedExisting, 0); // no island×mainland pairs exist today
  assert.ok(stats.crossings.min >= PARAMS.minCrossings);
  assert.ok(manifest.length <= stats.capUnique);

  const comps = connectedComponents(buildGraph(pairs.concat(stats.corePairs)));
  assert.equal(comps.length, 1);

  // determinism on real data
  assert.equal(JSON.stringify(manifest), JSON.stringify(gen(data, PARAMS, 42).manifest));
});
