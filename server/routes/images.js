const { Router } = require('express');
const Image = require('../models/Image');

const router = Router();

// GET /api/images?format=json|csv
router.get('/', async (req, res) => {
  try {
    const images = await Image.find({}, { __v: 0 }).sort({ eloRating: -1 }).lean();

    if (req.query.format === 'csv') {
      const rows = ['rank,filename,name,eloRating,comparisons,wins,width,height'];
      images.forEach((img, i) => {
        rows.push([
          i + 1,
          img.filename,
          `"${String(img.name).replace(/"/g, '""')}"`,
          img.eloRating,
          img.comparisons,
          img.wins,
          img.width ?? '',
          img.height ?? '',
        ].join(','));
      });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="elo-rankings.csv"');
      return res.send(rows.join('\n'));
    }

    res.json(images);
  } catch (err) {
    console.error('GET /api/images error:', err.message);
    res.status(500).json({ error: 'Failed to fetch images.' });
  }
});

module.exports = router;
