import { useState, useEffect } from 'react';
import BarChart from '../components/charts/BarChart';
import DistributionChart from '../components/charts/DistributionChart';
import ScatterChart from '../components/charts/ScatterChart';
import { previewSrc, winRate } from '../utils/imageUtils';

export default function ResultsPage() {
  const [images,      setImages]      = useState([]);
  const [config,      setConfig]      = useState({});
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [distData,    setDistData]    = useState(null);
  const [distLoading, setDistLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/images').then((r) => r.json()),
      fetch('/api/config').then((r) => r.json()),
    ])
      .then(([imgs, cfg]) => {
        setImages(imgs);
        setConfig(cfg);
        setLoading(false);
        const nReplays = cfg.eloNReplays     ?? 50;
        const imgLimit = cfg.chartImageLimit ?? 0;
        const params = new URLSearchParams({ n: nReplays });
        if (imgLimit > 0) params.set('limit', imgLimit);
        fetch(`/api/distributions?${params}`)
          .then((r) => r.json())
          .then((d) => { setDistData(Array.isArray(d) ? d : []); setDistLoading(false); })
          .catch(() => setDistLoading(false));
      })
      .catch(() => {
        setError('Could not load results.');
        setLoading(false);
        setDistLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="loading-screen">
        <p className="error-message">{error}</p>
      </div>
    );
  }

  const totalComparisons = images.reduce((s, img) => s + img.comparisons, 0) / 2 | 0;
  const rated = images.filter((img) => img.comparisons > 0);
  const distByFilename = distData
    ? Object.fromEntries(distData.map((d) => [d.filename, d]))
    : null;

  return (
    <div className="results-page">
      <header className="results-header">
        <div>
          <p className="results-eyebrow">{config.appTitle ?? 'ELO Rating'}</p>
          <h1 className="results-title">Results</h1>
          <p className="results-meta">
            {images.length} images &middot; {totalComparisons} comparisons recorded
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
          <a className="results-export-btn" href="/api/images?format=csv" download="elo-rankings.csv">
            Export CSV
          </a>
          <a className="results-export-btn" href="/api/download">
            Download ZIP
          </a>
        </div>
      </header>

      <section className="results-section">
        <h2 className="results-section-title">Rankings</h2>
        <div className="results-grid">
          {images.map((img, i) => (
            <div key={img._id} className="results-card">
              <div className="results-card-img-wrap">
                <img
                  src={previewSrc(img.filename)}
                  onError={(e) => { e.currentTarget.src = `/images/${img.filename}`; }}
                  alt={img.name}
                  className="results-card-img"
                  loading="lazy"
                />
                <span className={`results-card-rank ${i < 3 ? 'results-card-rank-top' : 'results-card-rank-other'}`}>
                  #{i + 1}
                </span>
              </div>
              <div className="results-card-body">
                <p className="results-card-name" title={img.name}>{img.name}</p>
                <div className="results-card-stats">
                  <div className="results-stat">
                    <span className="results-stat-value" style={{ color: 'var(--accent)' }}>
                      {Math.round(img.eloRating)}
                    </span>
                    <span className="results-stat-label">ELO</span>
                  </div>
                  <div className="results-stat">
                    <span className="results-stat-value">{img.comparisons}</span>
                    <span className="results-stat-label">comparisons</span>
                  </div>
                  <div className="results-stat">
                    <span className="results-stat-value">
                      {winRate(img)}{img.comparisons > 0 ? '%' : ''}
                    </span>
                    <span className="results-stat-label">win rate</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {rated.length > 1 && (
        <section className="results-section">
          <h2 className="results-section-title">Statistics</h2>
          <div className="results-charts-grid">
            <DistributionChart
              config={config}
              distData={distData}
              distLoading={distLoading}
              className="results-chart-wide"
            />
            <BarChart
              images={rated}
              valueKey="eloRating"
              label="ELO rating"
              formatValue={(img) => Math.round(img.eloRating).toString()}
              accent="#FF9500"
              distByFilename={distByFilename}
            />
            <BarChart
              images={rated}
              valueKey="comparisons"
              label="Comparisons per image"
              formatValue={(img) => img.comparisons.toString()}
              accent="rgba(255,255,255,0.55)"
            />
            <ScatterChart images={images} className="results-chart-wide" />
          </div>
        </section>
      )}
    </div>
  );
}
