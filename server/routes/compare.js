const { Router } = require('express');
const Image   = require('../models/Image');
const Session = require('../models/Session');
const { recomputeAndPersist } = require('../elo');

const router = Router();

// POST /api/compare
router.post('/', async (req, res) => {
  const { winnerId, loserId, username, sessionId } = req.body;

  if (!winnerId || !loserId || !username) {
    return res.status(400).json({ error: 'Missing required fields: winnerId, loserId, username.' });
  }
  if (winnerId === loserId) {
    return res.status(400).json({ error: 'winnerId and loserId must refer to different images.' });
  }

  try {
    const [winner, loser] = await Promise.all([
      Image.findById(winnerId),
      Image.findById(loserId),
    ]);

    if (!winner || !loser) {
      return res.status(404).json({ error: 'One or both images not found.' });
    }

    winner.comparisons += 1;
    winner.wins += 1;
    loser.comparisons += 1;

    if (sessionId) {
      const { isCalibration, thinkingTime, winnerPosition, loserPosition } = req.body;
      Session.findByIdAndUpdate(
        sessionId,
        { $push: { comparisons: {
          winnerId, loserId, skipped: false, decidedAt: new Date(),
          isCalibration:  isCalibration  ?? false,
          thinkingTime:   thinkingTime   ?? null,
          winnerPosition: winnerPosition ?? null,
          loserPosition:  loserPosition  ?? null,
        } } }
      ).catch((e) => console.warn('Session log update failed:', e.message));
    }

    await Promise.all([winner.save(), loser.save()]);

    const K        = parseInt(process.env.ELO_K_FACTOR  || '100', 10);
    const nReplays = parseInt(process.env.ELO_N_REPLAYS || '50',  10);
    const newRatings = await recomputeAndPersist(K, nReplays);

    res.json({
      winner: { id: winner._id, eloRating: newRatings[String(winner._id)] ?? winner.eloRating },
      loser:  { id: loser._id,  eloRating: newRatings[String(loser._id)]  ?? loser.eloRating  },
    });
  } catch (err) {
    console.error('POST /api/compare error:', err.message);
    res.status(500).json({ error: 'Failed to update ELO ratings.' });
  }
});

module.exports = router;
