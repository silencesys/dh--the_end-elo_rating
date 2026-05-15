const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const Image = require('../models/Image');
const Session = require('../models/Session');

const router = Router();

// GET /api/download
// Streams a .zip containing:
//   elo-ratings.json  — all images sorted by ELO desc
//   images/           — full-resolution image files
router.get('/', async (req, res) => {
  try {
    const [images, sessions] = await Promise.all([
      Image.find({}, { __v: 0 }).sort({ eloRating: -1 }).lean(),
      Session.find({}).sort({ startedAt: 1 }).lean(),
    ]);

    const imagesDir = path.join(__dirname, '../../images');

    if (!fs.existsSync(imagesDir)) {
      return res.status(404).json({ error: 'Images directory not found.' });
    }

    const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const filename = `elo-export-${timestamp}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.on('error', (err) => {
      console.error('Archive error:', err.message);
      res.destroy();
    });

    archive.pipe(res);

    const json = JSON.stringify(
      images.map((img, i) => ({
        rank:        i + 1,
        filename:    img.filename,
        name:        img.name,
        eloRating:   img.eloRating,
        comparisons: img.comparisons,
        wins:        img.wins,
        winRate:     img.comparisons > 0
          ? parseFloat(((img.wins / img.comparisons) * 100).toFixed(2))
          : null,
        width:       img.width ?? null,
        height:      img.height ?? null,
      })),
      null,
      2
    );
    archive.append(json, { name: 'elo-ratings.json' });

    // Build sessions export
    const imageIds = new Set();
    for (const s of sessions) {
      for (const c of s.comparisons) {
        if (c.winnerId) imageIds.add(String(c.winnerId));
        if (c.loserId)  imageIds.add(String(c.loserId));
      }
    }
    const imageRecords = await Image.find({ _id: { $in: [...imageIds] } }, { filename: 1, name: 1 }).lean();
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const imageMap = {};
    for (const img of imageRecords) {
      imageMap[String(img._id)] = { shelfmark: img.name, url: `${baseUrl}/images/${img.filename}` };
    }

    const sessionsJson = JSON.stringify(
      {
        sessions: sessions.map((s) => ({
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
              entropyRated:        true,
              isCalibration:       c.isCalibration,
              thinkingTime:        c.thinkingTime,
              winnerHigherEntropy: winner ? { ...winner, position: c.winnerPosition } : null,
              loserLowerEntropy:   loser  ? { ...loser,  position: c.loserPosition  } : null,
            };
          }),
        })),
      },
      null,
      2
    );
    archive.append(sessionsJson, { name: `sessions_${timestamp}.json` });

    archive.directory(imagesDir, 'images');

    await archive.finalize();
  } catch (err) {
    console.error('GET /api/download error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to create download.' });
    }
  }
});

module.exports = router;
