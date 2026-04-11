#!/usr/bin/env node
/**
 * migrate-legacy-sessions.js
 *
 * Converts legacy JSONBin double-mode session data into two MongoDB Extended
 * JSON files ready for mongoimport:
 *
 * USAGE
 *   node scripts/migrate-legacy-sessions.js \
 *     --input     sessions_import.json \
 *     --output    migration           \
 *     --k         100                 \
 *     --n-replays 50
 *
 *   Result:
 *     migration-images.json
 *     migration-sessions.json
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const INPUT_FILE    = arg('--input',  null);
const OUTPUT_PREFIX = arg('--output', 'migration');
const K_FACTOR      = parseInt(arg('--k',        '100'), 10);
const N_REPLAYS     = parseInt(arg('--n-replays', '50'),  10);

if (!INPUT_FILE) {
  console.error('Error: --input <path> is required.');
  process.exit(1);
}

let   _oidCounter = crypto.randomBytes(3).readUIntBE(0, 3);
const _oidMachine = crypto.randomBytes(5).toString('hex');

function newOid(dateOrStr) {
  const ms  = dateOrStr ? new Date(dateOrStr).getTime() : Date.now();
  const ts  = Math.floor(ms / 1000).toString(16).padStart(8, '0');
  const cnt = (_oidCounter++ & 0xFFFFFF).toString(16).padStart(6, '0');
  return { $oid: ts + _oidMachine + cnt };
}

function toDate(val) {
  if (!val) return null;
  return { $date: new Date(val).toISOString() };
}

const raw = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));

const rawSessions = Array.isArray(raw)
  ? raw
  : (raw.record?.sessions ?? raw.sessions ?? []);

if (!rawSessions.length) {
  console.error('No sessions found in input file. Check the JSON structure.');
  process.exit(1);
}

const byId = {};
for (const s of rawSessions) {
  const id = s.sessionID;
  if (!id) continue;
  if (!byId[id] || (s.combinations?.length ?? 0) > (byId[id].combinations?.length ?? 0)) {
    byId[id] = s;
  }
}
const sessions     = Object.values(byId);
const dedupDropped = rawSessions.length - sessions.length;

function filenameFromRef(ref) {
  if (!ref) return null;
  const src = typeof ref === 'string' ? ref : (ref.url ?? ref.filename ?? '');
  return path.basename(src) || null;
}

function imageNameFor(filename) {
  return filename.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
}

const filenameSet = new Set();
for (const s of sessions) {
  for (const c of (s.combinations ?? [])) {
    if (!c.entropyRated) continue;
    const w = filenameFromRef(c.winnerHigherEntropy);
    const l = filenameFromRef(c.loserLowerEntropy);
    if (w) filenameSet.add(w);
    if (l) filenameSet.add(l);
  }
}

const earliestTs = sessions
  .map((s) => s.timestamp)
  .filter(Boolean)
  .sort()[0] ?? new Date().toISOString();

const imageOid = {};
for (const filename of filenameSet) {
  imageOid[filename] = newOid(earliestTs);
}

sessions.sort((a, b) => {
  const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
  const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
  return ta - tb;
});

let totalComparisons = 0;
let skippedCount     = 0;

const allRatedPairs = [];
const sessionDocs   = [];

for (const s of sessions) {
  const comparisonsOut = [];

  for (const c of (s.combinations ?? [])) {
    if (!c.entropyRated) {
      skippedCount++;
      comparisonsOut.push({
        winnerId:       null,
        loserId:        null,
        skipped:        true,
        isCalibration:  c.isCalibration ?? false,
        thinkingTime:   null,
        winnerPosition: null,
        loserPosition:  null,
        decidedAt:      toDate(s.timestamp),
      });
      continue;
    }

    const winner = filenameFromRef(c.winnerHigherEntropy);
    const loser  = filenameFromRef(c.loserLowerEntropy);
    if (!winner || !loser) continue;

    allRatedPairs.push({ winner, loser });
    totalComparisons++;

    comparisonsOut.push({
      winnerId:       imageOid[winner] ?? null,
      loserId:        imageOid[loser]  ?? null,
      skipped:        false,
      isCalibration:  c.isCalibration ?? false,
      thinkingTime:   c.thinkingTime  ?? null,
      winnerPosition: (typeof c.winnerHigherEntropy === 'object' ? c.winnerHigherEntropy?.position : null) ?? null,
      loserPosition:  (typeof c.loserLowerEntropy   === 'object' ? c.loserLowerEntropy?.position   : null) ?? null,
      decidedAt:      toDate(s.timestamp),
    });
  }

  const startedAt   = s.timestamp ?? new Date().toISOString();
  const completedAt = s.completed ? startedAt : null;

  sessionDocs.push({
    _id:              newOid(startedAt),
    username:         s.user ?? 'imported',
    startedAt:        toDate(startedAt),
    completedAt:      toDate(completedAt),
    durationMs:       null,
    comparisons:      comparisonsOut,
    _legacySessionId: s.sessionID,
  });
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function runOneReplay(pairs) {
  const r = {};
  for (const f of filenameSet) r[f] = 1500;
  for (const { winner, loser } of pairs) {
    const rw   = r[winner];
    const rl   = r[loser];
    const expW = 1 / (1 + Math.pow(10, (rl - rw) / 400));
    const expL = 1 / (1 + Math.pow(10, (rw - rl) / 400));
    r[winner] = rw + K_FACTOR * (1 - expW);
    r[loser]  = rl + K_FACTOR * (0 - expL);
  }
  return r;
}

const wins  = {};
const comps = {};
for (const f of filenameSet) { wins[f] = 0; comps[f] = 0; }
for (const { winner, loser } of allRatedPairs) {
  wins[winner]++;
  comps[winner]++;
  comps[loser]++;
}

const accumulated = {};
for (const f of filenameSet) accumulated[f] = 0;

process.stdout.write(`Running ${N_REPLAYS} ELO replay shuffles`);
for (let r = 0; r < N_REPLAYS; r++) {
  const pairs = [...allRatedPairs];
  shuffle(pairs);
  const ratings = runOneReplay(pairs);
  for (const f of filenameSet) accumulated[f] += ratings[f] ?? 1500;
  if ((r + 1) % 10 === 0) process.stdout.write('.');
}
process.stdout.write(' done\n');

const now = new Date().toISOString();

const imageDocs = [];
for (const filename of filenameSet) {
  imageDocs.push({
    _id:         imageOid[filename],
    filename,
    name:        imageNameFor(filename),
    width:       null,
    height:      null,
    eloRating:   Math.round(accumulated[filename] / N_REPLAYS),
    comparisons: comps[filename],
    wins:        wins[filename],
    createdAt:   toDate(earliestTs),
    updatedAt:   toDate(now),
  });
}

imageDocs.sort((a, b) => b.eloRating - a.eloRating);

const imagesFile   = `${OUTPUT_PREFIX}-images.json`;
const sessionsFile = `${OUTPUT_PREFIX}-sessions.json`;

fs.writeFileSync(imagesFile,   JSON.stringify(imageDocs,   null, 2), 'utf8');
fs.writeFileSync(sessionsFile, JSON.stringify(sessionDocs, null, 2), 'utf8');

console.log('');
console.log('Migration complete:');
console.log(`  Raw sessions loaded:  ${rawSessions.length}`);
console.log(`  After deduplication:  ${sessions.length}  (${dedupDropped} shorter duplicates dropped)`);
console.log(`  Images:               ${imageDocs.length}`);
console.log(`  Comparisons used:     ${totalComparisons}`);
console.log(`  Skipped combinations: ${skippedCount}`);
console.log(`  K-factor:             ${K_FACTOR}`);
console.log(`  ELO replays:          ${N_REPLAYS}`);
console.log('');
console.log(`  → ${imagesFile}   (${imageDocs.length} documents)`);
console.log(`  → ${sessionsFile}  (${sessionDocs.length} documents)`);
console.log('');
console.log('Import — images FIRST (sessions reference image ObjectIds):');
console.log(`  mongoimport --uri "YOUR_URI" --db elo-rating \\`);
console.log(`    --collection images   --file ${imagesFile}   --jsonArray`);
console.log(`  mongoimport --uri "YOUR_URI" --db elo-rating \\`);
console.log(`    --collection sessions --file ${sessionsFile} --jsonArray`);
