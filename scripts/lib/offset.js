'use strict';

/**
 * Cross-cohort offset estimation (verifier mode).
 *
 * After bridge annotation, the two former cohorts should sit on one comparable
 * scale. We recompute Elo from raw pairs (mirroring server/elo.js, but with a
 * *seeded* replay shuffle per D5) and measure the mean-rating offset between two
 * groups, bootstrapping over resampled comparisons to report a CI width — a
 * tight CI means the cohorts are well-tied.
 *
 * Note: with a disconnected graph each component is independently anchored at a
 * mean of exactly 1500 (Elo updates are zero-sum within a component), so the
 * offset is ~0 by construction and uninformative. This tool earns its keep on a
 * *connected* graph, where the offset reflects real cross-cohort information.
 */

const { seededShuffle, sampleWithReplacement } = require('./rng');
const { percentile } = require('./graph');

/** One Elo pass over `pairs` in their given order. Returns id -> rating. */
function runOneReplay(pairs, imageIds, K) {
  const ratings = new Map();
  for (const id of imageIds) ratings.set(id, 1500);
  for (const [w, l] of pairs) {
    const rw = ratings.get(w);
    const rl = ratings.get(l);
    const expW = 1 / (1 + Math.pow(10, (rl - rw) / 400));
    const delta = K * (1 - expW); // zero-sum: winner +delta, loser -delta
    ratings.set(w, rw + delta);
    ratings.set(l, rl - delta);
  }
  return ratings;
}

/**
 * Recompute Elo as the mean over `replays` seeded-shuffle passes.
 * @param {Array<[string,string]>} pairs
 * @param {string[]} imageIds
 * @param {{K?: number, replays?: number, rng: () => number}} opts
 * @returns {Map<string, number>} id -> mean rating
 */
function recomputeEloSeeded(pairs, imageIds, { K = 100, replays = 1, rng }) {
  const acc = new Map();
  for (const id of imageIds) acc.set(id, 0);
  for (let r = 0; r < replays; r++) {
    const shuffled = seededShuffle(pairs, rng);
    const ratings = runOneReplay(shuffled, imageIds, K);
    for (const id of imageIds) acc.set(id, acc.get(id) + ratings.get(id));
  }
  const out = new Map();
  for (const id of imageIds) out.set(id, acc.get(id) / replays);
  return out;
}

function meanOver(ratings, ids) {
  if (!ids.length) return 0;
  let s = 0;
  for (const id of ids) s += ratings.get(id) ?? 1500;
  return s / ids.length;
}

/**
 * Bootstrap the recomputed-Elo offset (meanRating(groupA) − meanRating(groupB)).
 * @param {Object} opts
 * @param {Array<[string,string]>} opts.pairs
 * @param {string[]} opts.imageIds
 * @param {string[]} opts.groupA
 * @param {string[]} opts.groupB
 * @param {() => number} opts.rng - seeded RNG; drives shuffles and resampling.
 * @param {number} [opts.K=100]
 * @param {number} [opts.replays=1] - Elo replays per fit.
 * @param {number} [opts.nBoot=200] - bootstrap resamples.
 * @param {number} [opts.ci=0.95] - central CI mass.
 * @returns {{point:number, mean:number, ciLow:number, ciHigh:number, ciWidth:number, nBoot:number, ci:number}}
 */
function bootstrapOffset({ pairs, imageIds, groupA, groupB, rng, K = 100, replays = 1, nBoot = 200, ci = 0.95 }) {
  const pointRatings = recomputeEloSeeded(pairs, imageIds, { K, replays, rng });
  const point = meanOver(pointRatings, groupA) - meanOver(pointRatings, groupB);

  const offsets = [];
  for (let b = 0; b < nBoot; b++) {
    const resampled = sampleWithReplacement(pairs, pairs.length, rng);
    const ratings = recomputeEloSeeded(resampled, imageIds, { K, replays, rng });
    offsets.push(meanOver(ratings, groupA) - meanOver(ratings, groupB));
  }
  offsets.sort((a, b) => a - b);

  const tail = ((1 - ci) / 2) * 100;
  const ciLow = percentile(offsets, tail);
  const ciHigh = percentile(offsets, 100 - tail);
  let sum = 0;
  for (const o of offsets) sum += o;
  const mean = offsets.length ? sum / offsets.length : 0;

  return { point, mean, ciLow, ciHigh, ciWidth: ciHigh - ciLow, nBoot, ci };
}

module.exports = { recomputeEloSeeded, bootstrapOffset };
