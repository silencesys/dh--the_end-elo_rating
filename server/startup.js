const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const Image = require('./models/Image');

const PREVIEW_WIDTH = 300;
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|webp|gif|avif|tiff)$/i;

async function generatePreviews() {
  const imagesDir = path.join(__dirname, '../images');
  const previewsDir = path.join(__dirname, '../previews');

  if (!fs.existsSync(imagesDir)) return;
  if (!fs.existsSync(previewsDir)) fs.mkdirSync(previewsDir, { recursive: true });

  const files = fs.readdirSync(imagesDir).filter((f) => IMAGE_EXTENSIONS.test(f));

  let generated = 0;
  for (const file of files) {
    const previewName = path.basename(file, path.extname(file)) + '.jpg';
    const previewPath = path.join(previewsDir, previewName);
    if (fs.existsSync(previewPath)) continue;
    try {
      await sharp(path.join(imagesDir, file))
        .resize({ width: PREVIEW_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(previewPath);
      generated++;
    } catch (err) {
      console.warn(`Preview failed for ${file}: ${err.message}`);
    }
  }

  if (generated > 0) console.log(`Generated ${generated} preview thumbnail(s) in /previews`);
  else console.log('Preview thumbnails already up to date');
}

async function seedImages() {
  const imagesDir = path.join(__dirname, '../images');
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
    return;
  }

  const files = fs.readdirSync(imagesDir).filter((f) => IMAGE_EXTENSIONS.test(f));

  for (const file of files) {
    const filePath = path.join(imagesDir, file);
    let width = null, height = null;
    try {
      const meta = await sharp(filePath).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
    } catch (err) {
      console.warn(`Could not read dimensions for ${file}: ${err.message}`);
    }

    const existing = await Image.findOne({ filename: file });
    if (!existing) {
      await Image.create({
        filename: file,
        name: path.basename(file, path.extname(file)).replace(/[_-]/g, ' '),
        width,
        height,
        eloRating: 1500,
        comparisons: 0,
        wins: 0,
      });
    } else if (existing.width == null && width != null) {
      await Image.updateOne({ _id: existing._id }, { $set: { width, height } });
    }
  }

  console.log(`Seeded ${files.length} image(s) from /images`);
}

module.exports = { seedImages, generatePreviews };
