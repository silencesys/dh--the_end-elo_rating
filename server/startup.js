const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const Image = require('./models/Image');

const PREVIEW_WIDTH = 300;
const MAX_IMAGE_HEIGHT = 1500;
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|webp|gif|avif|tiff)$/i;

const imagesDir = () => path.join(__dirname, '../images');
const previewsDir = () => path.join(__dirname, '../previews');

function listImageFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => IMAGE_EXTENSIONS.test(f));
}

function previewPathFor(file) {
  return path.join(previewsDir(), path.basename(file, path.extname(file)) + '.jpg');
}

function encodePipeline(inputPath, ext) {
  const pipeline = sharp(inputPath).resize({
    height: MAX_IMAGE_HEIGHT,
    withoutEnlargement: true,
  });
  switch (ext) {
    case '.png':
      return pipeline.png({ compressionLevel: 9 });
    case '.webp':
      return pipeline.webp({ quality: 85 });
    case '.gif':
      return pipeline.gif();
    case '.avif':
      return pipeline.avif({ quality: 80 });
    case '.tiff':
    case '.tif':
      return pipeline.tiff({ quality: 85 });
    default:
      return pipeline.jpeg({ quality: 85, mozjpeg: true });
  }
}

async function compressImageFile(file) {
  const filePath = path.join(imagesDir(), file);
  if (!fs.existsSync(filePath)) {
    return { compressed: false, width: null, height: null };
  }

  let meta;
  try {
    meta = await sharp(filePath).metadata();
  } catch (err) {
    console.warn(`Compress skipped for ${file}: ${err.message}`);
    return { compressed: false, width: null, height: null };
  }

  const dims = { width: meta.width ?? null, height: meta.height ?? null };
  if (!meta.height || meta.height <= MAX_IMAGE_HEIGHT) {
    return { compressed: false, ...dims };
  }

  const ext = path.extname(file).toLowerCase();
  const tmpPath = `${filePath}.compressing`;

  try {
    await encodePipeline(filePath, ext).toFile(tmpPath);
    fs.renameSync(tmpPath, filePath);

    const preview = previewPathFor(file);
    if (fs.existsSync(preview)) fs.unlinkSync(preview);

    const after = await sharp(filePath).metadata();
    return {
      compressed: true,
      width: after.width ?? null,
      height: after.height ?? null,
    };
  } catch (err) {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    console.warn(`Compress failed for ${file}: ${err.message}`);
    return { compressed: false, ...dims };
  }
}

async function compressImagesFor(filenames) {
  let compressed = 0;
  for (const file of filenames) {
    const result = await compressImageFile(file);
    if (result.compressed) compressed++;
  }
  return compressed;
}

async function compressImages() {
  const dir = imagesDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }

  const files = listImageFiles(dir);
  const compressed = await compressImagesFor(files);

  if (compressed > 0) {
    console.log(`Compressed ${compressed} image(s) to max height ${MAX_IMAGE_HEIGHT}px`);
  } else {
    console.log(`All images already at or below ${MAX_IMAGE_HEIGHT}px height`);
  }
}

async function generatePreviewFor(file, { force = false } = {}) {
  const srcPath = path.join(imagesDir(), file);
  if (!fs.existsSync(srcPath)) return false;

  const prevDir = previewsDir();
  if (!fs.existsSync(prevDir)) fs.mkdirSync(prevDir, { recursive: true });

  const previewPath = previewPathFor(file);
  if (!force && fs.existsSync(previewPath)) {
    const srcMtime = fs.statSync(srcPath).mtimeMs;
    const prevMtime = fs.statSync(previewPath).mtimeMs;
    if (prevMtime >= srcMtime) return false;
  }

  try {
    await sharp(srcPath)
      .resize({ width: PREVIEW_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(previewPath);
    return true;
  } catch (err) {
    console.warn(`Preview failed for ${file}: ${err.message}`);
    return false;
  }
}

async function generatePreviewsFor(filenames, { force = false } = {}) {
  let generated = 0;
  for (const file of filenames) {
    if (await generatePreviewFor(file, { force })) generated++;
  }
  return generated;
}

async function generatePreviews() {
  const imgDir = imagesDir();
  if (!fs.existsSync(imgDir)) return;

  const files = listImageFiles(imgDir);
  const generated = await generatePreviewsFor(files);

  if (generated > 0) console.log(`Generated ${generated} preview thumbnail(s) in /previews`);
  else console.log('Preview thumbnails already up to date');
}

async function seedImages() {
  const dir = imagesDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }

  const files = listImageFiles(dir);
  let created = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    let width = null;
    let height = null;
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
      created++;
    } else {
      const updates = {};
      if (width != null && (existing.width !== width || existing.height !== height)) {
        updates.width = width;
        updates.height = height;
      }
      if (Object.keys(updates).length > 0) {
        await Image.updateOne({ _id: existing._id }, { $set: updates });
      }
    }
  }

  console.log(
    `Seeded ${files.length} image(s) from /images` +
      (created > 0 ? ` (${created} new)` : '')
  );
}

async function runStartup() {
  await compressImages();
  await seedImages();
  await generatePreviews();
}

module.exports = {
  compressImages,
  compressImageFile,
  compressImagesFor,
  seedImages,
  generatePreviews,
  generatePreviewsFor,
  runStartup,
};
