'use strict';

const Image   = require('./models/Image');
const Session = require('./models/Session');

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

let _cache = null; // { ratings: {id: number}, distributions: {id: number[]} }

function runOneReplay(pairs, imageIds, K) {
  const ratings = Object.fromEntries(imageIds.map((id) => [id, 1500]));
  for (const [w, l] of pairs) {
    const rw = ratings[w];
    const rl = ratings[l];
    const expW = 1 / (1 + Math.pow(10, (rl - rw) / 400));
    const expL = 1 / (1 + Math.pow(10, (rw - rl) / 400));
    ratings[w] = rw + K * (1 - expW);
    ratings[l] = rl + K * (0 - expL);
  }
  return ratings;
}

function computeEloFull(pairs, imageIds, K, nReplays) {
  const accumulated    = Object.fromEntries(imageIds.map((id) => [id, 0]));
  const distributions  = Object.fromEntries(imageIds.map((id) => [id, []]));
  for (let r = 0; r < nReplays; r++) {
    const shuffled = [...pairs];
    shuffle(shuffled);
    const replayRatings = runOneReplay(shuffled, imageIds, K);
    for (const id of imageIds) {
      accumulated[id]    += replayRatings[id];
      distributions[id].push(Math.round(replayRatings[id]));
    }
  }
  const ratings = Object.fromEntries(
    imageIds.map((id) => [id, Math.round(accumulated[id] / nReplays)])
  );
  return { ratings, distributions };
}

function computeEloRatings(pairs, imageIds, K, nReplays) {
  return computeEloFull(pairs, imageIds, K, nReplays).ratings;
}

function computeEloDistributions(pairs, imageIds, K, nReplays) {
  return computeEloFull(pairs, imageIds, K, nReplays).distributions;
}

function getCachedDistributions() {
  return _cache ? _cache.distributions : null;
}

async function loadPairsFromDb() {
  const sessions = await Session.find({}, { comparisons: 1 }).lean();
  const pairs = [];
  const imageIdSet = new Set();
  for (const session of sessions) {
    for (const c of (session.comparisons ?? [])) {
      if (c.skipped || !c.winnerId || !c.loserId) continue;
      const w = String(c.winnerId);
      const l = String(c.loserId);
      pairs.push([w, l]);
      imageIdSet.add(w);
      imageIdSet.add(l);
    }
  }
  return { pairs, imageIds: [...imageIdSet] };
}

async function recomputeAndPersist(K, nReplays) {
  const { pairs, imageIds } = await loadPairsFromDb();
  if (!pairs.length) return {};

  const { ratings, distributions } = computeEloFull(pairs, imageIds, K, nReplays);

  const ops = imageIds.map((id) => ({
    updateOne: {
      filter: { _id: id },
      update: { $set: { eloRating: ratings[id] } },
    },
  }));
  await Image.bulkWrite(ops);

  _cache = { ratings, distributions };

  return ratings;
}

module.exports = {
  computeEloRatings,
  computeEloDistributions,
  computeEloFull,
  getCachedDistributions,
  loadPairsFromDb,
  recomputeAndPersist,
};
