const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const unzipper = require('unzipper');
const Image = require('../models/Image');
const requireApiKey = require('../middleware/requireApiKey');
const { compressImageFile, generatePreviewsFor } = require('../startup');

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only .zip files are accepted.'));
    }
  },
});

const IMAGES_DIR = path.resolve(__dirname, '../../images');

// POST /api/upload-images
// Accepts multipart/form-data with a single field "file" containing a ZIP.
// ZIP must have a flat structure:
//   *.jpg          — image files
//   metadata.json  — object keyed by filename
router.post('/', requireApiKey, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Send a ZIP as the "file" field.' });
  }

  let directory;
  try {
    directory = await unzipper.Open.buffer(req.file.buffer);
  } catch {
    return res.status(400).json({ error: 'Could not parse ZIP file.' });
  }

  const metaEntry = directory.files.find(
    (f) => path.basename(f.path) === 'metadata.json' && f.type === 'File'
  );
  if (!metaEntry) {
    return res.status(400).json({ error: 'metadata.json not found in ZIP.' });
  }

  let metadata;
  try {
    const raw = await metaEntry.buffer();
    metadata = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'metadata.json is not valid JSON.' });
  }

  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const results = { created: 0, updated: 0, compressed: 0, errors: [] };
  const written = [];

  const jpgEntries = directory.files.filter(
    (f) => f.type === 'File' && /\.jpe?g$/i.test(f.path) && !f.path.startsWith('__MACOSX')
  );

  for (const entry of jpgEntries) {
    const filename = path.basename(entry.path);

    const destPath = path.join(IMAGES_DIR, filename);
    try {
      const buf = await entry.buffer();
      fs.writeFileSync(destPath, buf);
      written.push(filename);
    } catch (err) {
      results.errors.push({ filename, error: `Failed to write file: ${err.message}` });
      continue;
    }

    const { compressed, width: fileWidth, height: fileHeight } =
      await compressImageFile(filename);
    if (compressed) results.compressed++;

    const meta = metadata[filename] ?? {};
    const doc = {
      name: meta['shelfmark'] ?? filename.replace(/\.[^.]+$/, ''),
      width: fileWidth ?? (typeof meta['width'] === 'number' ? meta['width'] : null),
      height: fileHeight ?? (typeof meta['height'] === 'number' ? meta['height'] : null),
      catNo: typeof meta['cat. No.'] === 'number' ? meta['cat. No.'] : null,
      originPlace: meta['origin-place'] ?? null,
      originDate: meta['origin-date'] ?? null,
      folioNumbers: typeof meta['folio numbers'] === 'number' ? meta['folio numbers'] : null,
      languages: Array.isArray(meta['languages']) ? meta['languages'] : [],
      genres: Array.isArray(meta['genres']) ? meta['genres'] : [],
      tagsTime: meta['tags time'] ?? null,
      tagsForm: meta['tags form'] ?? null,
      catalogue: meta['catalogue'] ?? null,
    };

    try {
      const existing = await Image.findOne({ filename });
      if (existing) {
        await Image.updateOne({ filename }, { $set: doc });
        results.updated++;
      } else {
        await Image.create({ filename, ...doc });
        results.created++;
      }
    } catch (err) {
      results.errors.push({ filename, error: `DB error: ${err.message}` });
    }
  }

  const previewsGenerated = await generatePreviewsFor(written, { force: true });

  res.json({
    message: 'Upload complete.',
    total: jpgEntries.length,
    previewsGenerated,
    ...results,
  });
});

module.exports = router;
