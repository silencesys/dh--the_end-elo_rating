const loadedUrls = new Set();
const inFlight = new Map();

export function preloadImage(url) {
  if (loadedUrls.has(url)) return Promise.resolve();
  if (inFlight.has(url)) return inFlight.get(url);

  const img = new window.Image();
  img.src = url;

  // img.decode() waits for download + decode into pixel data.
  // Falls back to onload for environments that don't support decode().
  const ready = img.decode
    ? img.decode().catch(() => {})
    : new Promise((r) => { img.onload = img.onerror = r; });

  const p = ready.then(() => {
    loadedUrls.add(url);
    inFlight.delete(url);
  });

  inFlight.set(url, p);
  return p;
}

export function preloadImages(urls) {
  return Promise.all(urls.map(preloadImage));
}

export function isLoaded(url) {
  return loadedUrls.has(url);
}
