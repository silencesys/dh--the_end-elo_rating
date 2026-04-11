const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const Image = require('../models/Image');

const router = Router();

// GET /api/download
// Streams a .zip containing:
//   elo-ratings.json  — all images sorted by ELO desc
//   images/           — full-resolution image files
router.get('/', async (req, res) => {
  try {
    const images = await Image.find({}, { __v: 0 }).sort({ eloRating: -1 }).lean();

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
