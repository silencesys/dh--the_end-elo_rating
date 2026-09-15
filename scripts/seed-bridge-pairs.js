#!/usr/bin/env node
'use strict';

/**
 * seed-bridge-pairs.js — load an M2 bridge manifest into the BridgePair collection.
 *
 * Idempotent: pairs are keyed on the sorted (aId,bId) via a unique compound index,
 * so re-running upserts in place without creating duplicates. Reuses server/db.js
 * for the connection.
 *
 * Flags:
 *   --seed <n>      manifest seed -> data/bridge/bridge-pairs.<seed>.json   [42]
 *   --input <path>  explicit manifest path (overrides --seed)
 *   --replace       delete all existing BridgePair docs before seeding
 *   -h, --help
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { buildGraph, connectedComponents } = require('./lib/graph');

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (flag) => process.argv.includes(flag);

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

/** Original island image set, from comparisons that are NOT bridge votes. */
async function originalIslandSet(Session) {
  const sessions = await Session.find({ source: { $ne: 'bridge' } }, { comparisons: 1 }).lean();
  const pairs = [];
  for (const s of sessions) {
    for (const c of (s.comparisons || [])) {
      if (c.skipped || !c.winnerId || !c.loserId) continue;
      pairs.push([String(c.winnerId), String(c.loserId)]);
    }
  }
  const components = connectedComponents(buildGraph(pairs));
  return new Set(components.slice(1).flat()); // everything but the largest = islands
}

async function main() {
  if (has('-h') || has('--help')) {
    process.stdout.write(
      'Usage: node scripts/seed-bridge-pairs.js [--seed <n>] [--input <path>] [--replace]\n'
    );
    return 0;
  }

  const seed = parseInt(arg('--seed', '42'), 10);
  const manifestPath = arg('--input', path.join(ROOT, 'data', 'bridge', `bridge-pairs.${seed}.json`));

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest not found: ${manifestPath} (generate it with generate-bridge-pairs.js)`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  loadDotEnv();
  const { connect } = require(path.join(ROOT, 'server', 'db.js'));
  const Session = require(path.join(ROOT, 'server', 'models', 'Session'));
  const BridgePair = require(path.join(ROOT, 'server', 'models', 'BridgePair'));
  await connect();

  const islandSet = await originalIslandSet(Session);

  if (has('--replace')) {
    const { deletedCount } = await BridgePair.deleteMany({});
    console.log(`Removed ${deletedCount} existing bridge pair(s) (--replace).`);
  }

  let islandLabeled = 0;
  const ops = manifest.map((e, i) => {
    const a = String(e.aId);
    const b = String(e.bId);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    let islandId = null;
    if (islandSet.has(a)) islandId = a;
    else if (islandSet.has(b)) islandId = b;
    if (islandId) islandLabeled++;
    return {
      updateOne: {
        filter: { aId: lo, bId: hi },
        update: { $set: { aId: lo, bId: hi, islandId, band: e.band, targetCount: e.targetCount, seed, order: i } },
        upsert: true,
      },
    };
  });

  const result = await BridgePair.bulkWrite(ops);
  const total = await BridgePair.countDocuments({});
  const distinctIslands = new Set(
    (await BridgePair.find({ islandId: { $ne: null } }, { islandId: 1 }).lean()).map((d) => String(d.islandId))
  );

  console.log('');
  console.log('Bridge-pair seeding complete:');
  console.log(`  manifest:            ${path.relative(ROOT, manifestPath)}  (${manifest.length} pairs, seed ${seed})`);
  console.log(`  upserted:            ${result.upsertedCount} new, ${result.modifiedCount} updated`);
  console.log(`  island endpoints set:${islandLabeled} / ${manifest.length}`);
  console.log(`  distinct islands:    ${distinctIslands.size}`);
  console.log(`  total BridgePair docs: ${total}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('seed-bridge-pairs error:', err.message);
    process.exit(1);
  });
