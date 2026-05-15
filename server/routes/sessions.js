const { Router } = require('express');
const Session = require('../models/Session');
const Image = require('../models/Image');

const router = Router();

// POST /api/sessions — open a new session on login
router.post('/', async (req, res) => {
  const { username } = req.body;
  if (!username || typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'username is required.' });
  }
  try {
    const session = await Session.create({
      username: username.trim(),
      source: (typeof req.body.source === 'string' && req.body.source.trim()) ? req.body.source.trim() : null,
    });
    res.status(201).json({ sessionId: session._id });
  } catch (err) {
    console.error('POST /api/sessions error:', err.message);
    res.status(500).json({ error: 'Failed to create session.' });
  }
});

// PATCH /api/sessions/:id/complete — seal a session with final duration
router.patch('/:id/complete', async (req, res) => {
  const { durationMs } = req.body;
  if (typeof durationMs !== 'number' || durationMs < 0) {
    return res.status(400).json({ error: 'durationMs must be a non-negative number.' });
  }
  try {
    const session = await Session.findByIdAndUpdate(
      req.params.id,
      { completedAt: new Date(), durationMs },
      { new: true }
    );
    if (!session) return res.status(404).json({ error: 'Session not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/sessions/:id/complete error:', err.message);
    res.status(500).json({ error: 'Failed to complete session.' });
  }
});

// POST /api/sessions/:id/skip — log a skipped pair without touching ELO
router.post('/:id/skip', async (req, res) => {
  const { winnerId, loserId } = req.body;
  try {
    await Session.findByIdAndUpdate(
      req.params.id,
      {
        $push: {
          comparisons: {
            winnerId:       winnerId       || null,
            loserId:        loserId        || null,
            skipped:        true,
            decidedAt:      new Date(),
            isCalibration:  req.body.isCalibration  ?? false,
            thinkingTime:   req.body.thinkingTime   ?? null,
            winnerPosition: req.body.winnerPosition ?? null,
            loserPosition:  req.body.loserPosition  ?? null,
          },
        },
      }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/sessions/:id/skip error:', err.message);
    res.status(500).json({ error: 'Failed to log skip.' });
  }
});

// GET /api/sessions?format=json|csv|sessions
router.get('/', async (req, res) => {
  try {
    const sessions = await Session.find({}).sort({ startedAt: 1 }).lean();

    if (req.query.format === 'sessions') {
      // Collect all image IDs referenced across all comparisons
      const imageIds = new Set();
      for (const s of sessions) {
        for (const c of s.comparisons) {
          if (c.winnerId) imageIds.add(String(c.winnerId));
          if (c.loserId)  imageIds.add(String(c.loserId));
        }
      }

      const images = await Image.find({ _id: { $in: [...imageIds] } }, { filename: 1, name: 1 }).lean();
      const imageMap = {};
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      for (const img of images) {
        imageMap[String(img._id)] = {
          shelfmark: img.name,
          url: `${baseUrl}/images/${img.filename}`,
        };
      }

      const formatted = sessions.map((s) => ({
        sessionID:    String(s._id),
        user:         s.username,
        source:       s.source ?? null,
        timestamp:    s.startedAt ? s.startedAt.toISOString() : null,
        completed:    s.completedAt !== null,
        combinations: s.comparisons.map((c) => {
          const winner = c.winnerId ? imageMap[String(c.winnerId)] : null;
          const loser  = c.loserId  ? imageMap[String(c.loserId)]  : null;

          if (c.skipped) {
            return {
              entropyRated:  false,
              isCalibration: c.isCalibration,
              folio1: winner ? { ...winner, position: c.winnerPosition } : null,
              folio2: loser  ? { ...loser,  position: c.loserPosition  } : null,
            };
          }

          return {
            entropyRated:         true,
            isCalibration:        c.isCalibration,
            thinkingTime:         c.thinkingTime,
            winnerHigherEntropy:  winner ? { ...winner, position: c.winnerPosition } : null,
            loserLowerEntropy:    loser  ? { ...loser,  position: c.loserPosition  } : null,
          };
        }),
      }));

      return res.json({ sessions: formatted });
    }

    if (req.query.format === 'csv') {
      const rows = [
        'sessionId,username,startedAt,completedAt,durationMs,pairsTotal,pairsRated,winnerId,loserId,skipped,decidedAt',
      ];
      for (const s of sessions) {
        const pairsTotal = s.comparisons.length;
        const pairsRated = s.comparisons.filter((c) => !c.skipped).length;
        const base = [
          s._id,
          `"${s.username.replace(/"/g, '""')}"`,
          s.startedAt   ? s.startedAt.toISOString()   : '',
          s.completedAt ? s.completedAt.toISOString() : '',
          s.durationMs ?? '',
          pairsTotal,
          pairsRated,
        ];
        if (s.comparisons.length === 0) {
          rows.push([...base, '', '', '', ''].join(','));
        } else {
          for (const c of s.comparisons) {
            rows.push([
              ...base,
              c.winnerId || '',
              c.loserId  || '',
              c.skipped ? 'true' : 'false',
              c.decidedAt ? new Date(c.decidedAt).toISOString() : '',
            ].join(','));
          }
        }
      }
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="sessions.csv"');
      return res.send(rows.join('\n'));
    }

    res.json(sessions);
  } catch (err) {
    console.error('GET /api/sessions error:', err.message);
    res.status(500).json({ error: 'Failed to fetch sessions.' });
  }
});

module.exports = router;
