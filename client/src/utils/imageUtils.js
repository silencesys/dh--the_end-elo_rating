export function previewSrc(filename) {
  return `/previews/${filename.replace(/\.[^.]+$/, '.jpg')}`;
}

export function winRate(img) {
  return img.comparisons > 0
    ? ((img.wins / img.comparisons) * 100).toFixed(1)
    : '—';
}
