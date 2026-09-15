const { Router } = require('express');
const Session = require('../models/Session');
const Image = require('../models/Image');
const BridgePair = require('../models/BridgePair');
const {
  pairKeyOf,
  countRatedByPair,
  sessionSeenKeys,
  selectNextBridgePair,
  computeProgress,
} = require('../bridgeSelect');

const router = Router();

// Fields the compare UI needs for an image.
const IMAGE_FIELDS = { filename: 1, name: 1, width: 1, height: 1 };

/** Load bridge pairs + the per-pair rated counts (bounded to bridge keys). */
async function loadBridgeState() {
  const bridgePairs = await BridgePair.find({}).sort({ order: 1 }).lean();
  const keyFilter = new Set(bridgePairs.map((bp) => pairKeyOf(bp.aId, bp.bId)));
  const sessions = await Session.find({}, { comparisons: 1 }).lean();
  const ratedCounts = countRatedByPair(sessions, keyFilter);
  return { bridgePairs, ratedCounts };
}

// GET /api/bridge/next?sessionId=… — next bridge pair to rate, or { pair:null, done:true }.
router.get('/next', async (req, res) => {
  try {
    const { bridgePairs, ratedCounts } = await loadBridgeState();
    if (!bridgePairs.length) return res.json({ pair: null, done: true });

    let seen = new Set();
    if (req.query.sessionId) {
      const sess = await Session.findById(req.query.sessionId, { comparisons: 1 }).lean();
      seen = sessionSeenKeys(sess);
    }

    const next = selectNextBridgePair(bridgePairs, ratedCounts, seen);
    if (!next) return res.json({ pair: null, done: true });

    const [imgA, imgB] = await Promise.all([
      Image.findById(next.aId, IMAGE_FIELDS).lean(),
      Image.findById(next.bId, IMAGE_FIELDS).lean(),
    ]);
    if (!imgA || !imgB) {
      return res.status(500).json({ error: 'Bridge pair references a missing image.' });
    }

    const rated = ratedCounts.get(pairKeyOf(next.aId, next.bId)) || 0;
    res.json({
      pair: [imgA, imgB],
      band: next.band,
      remaining: next.targetCount - rated,
    });
  } catch (err) {
    console.error('GET /api/bridge/next error:', err.message);
    res.status(500).json({ error: 'Failed to fetch next bridge pair.' });
  }
});

// GET /api/bridge/progress — monitoring totals.
router.get('/progress', async (_req, res) => {
  try {
    const { bridgePairs, ratedCounts } = await loadBridgeState();
    res.json(computeProgress(bridgePairs, ratedCounts));
  } catch (err) {
    console.error('GET /api/bridge/progress error:', err.message);
    res.status(500).json({ error: 'Failed to compute bridge progress.' });
  }
});

module.exports = router;
