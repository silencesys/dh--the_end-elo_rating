'use strict';

const { Router } = require('express');
const Image = require('../models/Image');
const { getCachedDistributions, loadPairsFromDb, computeEloFull } = require('../elo');

const router = Router();

// GET /api/distributions?n=50&limit=0
//
// Runs N ELO replay shuffles over all stored session comparisons and returns
// per-image distributions — one ELO value per replay per image.
//
// Query params:
//   n     — number of replays (default: ELO_N_REPLAYS env, capped at 500)
//   limit — only return the top-N images sorted by mean ELO ascending
//           (0 = return all, default 0)
//
// Response: array sorted by mean ELO ascending:
//   { filename, name, mean, min, max, q1, q3, values: number[] }
router.get('/', async (req, res) => {
  try {
    const K        = parseInt(process.env.ELO_K_FACTOR  || '100', 10);
    const defN     = parseInt(process.env.ELO_N_REPLAYS || '50',  10);
    const nReplays = Math.min(500, Math.max(1, parseInt(req.query.n    || String(defN), 10)));
    const limit    = Math.max(0,              parseInt(req.query.limit || '0',          10));

    const { pairs, imageIds } = await loadPairsFromDb();
    if (!pairs.length) return res.json([]);

    const images       = await Image.find({ _id: { $in: imageIds } }, { filename: 1, name: 1 }).lean();
    const idToFilename = Object.fromEntries(images.map((img) => [String(img._id), img.filename]));
    const idToName     = Object.fromEntries(images.map((img) => [String(img._id), img.name]));

    let allDist = getCachedDistributions();
    if (!allDist) {
      allDist = computeEloFull(pairs, imageIds, K, nReplays).distributions;
    }

    const validIds = imageIds.filter((id) => allDist[id]);

    let result = validIds.map((id) => {
      const vals   = allDist[id];
      const mean   = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
      const sorted = [...vals].sort((a, b) => a - b);
      return {
        filename: idToFilename[id] ?? id,
        name:     idToName[id]     ?? id,
        mean,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        q1:  sorted[Math.floor(sorted.length * 0.25)],
        q3:  sorted[Math.floor(sorted.length * 0.75)],
        values: vals,
      };
    });

    result.sort((a, b) => a.mean - b.mean);
    if (limit > 0) result = result.slice(0, limit);

    res.json(result);
  } catch (err) {
    console.error('GET /api/distributions error:', err.message);
    res.status(500).json({ error: 'Failed to compute ELO distributions.' });
  }
});

module.exports = router;
