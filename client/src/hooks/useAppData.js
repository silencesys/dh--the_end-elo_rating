import { useState, useEffect, useCallback } from 'react';

const DEFAULT_CONFIG = {
  appTitle: 'ELO Rating',
  question: 'Which image do you prefer?',
  questionDescription: '',
  timePerComparison: 5000,
  preloadCount: 6,
  sessionPairsLimit: 0,
};

export function useAppData() {
  const [images,  setImages]  = useState([]);
  const [config,  setConfig]  = useState(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/images').then((r) => r.json()),
      fetch('/api/config').then((r) => r.json()),
    ])
      .then(([imgs, cfg]) => {
        setImages(imgs);
        setConfig({ ...DEFAULT_CONFIG, ...cfg });
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load app data:', err);
        setError('Failed to connect to the server. Is it running?');
        setLoading(false);
      });
  }, []);

  const refreshImages = useCallback(() => {
    fetch('/api/images')
      .then((r) => r.json())
      .then((fresh) => {
        setImages((prev) => {
          const freshById = Object.fromEntries(
            fresh.map((img) => [String(img._id), img])
          );
          return prev.map((img) => {
            const f = freshById[String(img._id)];
            if (!f) return img;
            // Keep local comparisons/wins counts if they are ahead of the
            // server (optimistic update), otherwise take the server value.
            return {
              ...f,
              comparisons: Math.max(f.comparisons, img.comparisons),
              wins: Math.max(f.wins, img.wins),
            };
          });
        });
      })
      .catch((err) => console.warn('Background image refresh failed:', err));
  }, []);

  return { images, setImages, config, loading, error, refreshImages };
}
