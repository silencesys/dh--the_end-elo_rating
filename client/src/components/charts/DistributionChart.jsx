import { useState, useEffect, useRef } from 'react';
import { previewSrc } from '../../utils/imageUtils';

/** Gaussian kernel density estimate over `values` evaluated at `points`. */
function kde(values, points, bandwidth) {
  const n = values.length;
  return points.map((p) => {
    const sum = values.reduce((acc, v) => {
      const z = (p - v) / bandwidth;
      return acc + Math.exp(-0.5 * z * z);
    }, 0);
    return sum / (n * bandwidth * Math.sqrt(2 * Math.PI));
  });
}

/** Silverman's rule-of-thumb bandwidth. */
function silverman(values) {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const iqr = (() => {
    const s = [...values].sort((a, b) => a - b);
    return s[Math.floor(n * 0.75)] - s[Math.floor(n * 0.25)];
  })();
  return 0.9 * Math.min(std, iqr / 1.34) * Math.pow(n, -0.2);
}

export default function DistributionChart({ config, distData, distLoading, className = '' }) {
  const data    = distData;
  const loading = distLoading ?? true;
  const [tooltip,        setTooltip]        = useState(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const tooltipRef   = useRef(null);
  const containerRef = useRef(null);

  const nReplays = config.eloNReplays     ?? 50;
  const imgLimit = config.chartImageLimit ?? 0;

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!tooltip || !tooltipRef.current) return;
    const el = tooltipRef.current;
    const { width, height } = el.getBoundingClientRect();
    const M = 8;
    let left = tooltip.x + 16;
    let top  = tooltip.y - height / 2;
    if (left + width  > window.innerWidth  - M) left = tooltip.x - width - 12;
    if (top            < M)                      top  = M;
    if (top + height   > window.innerHeight - M) top  = window.innerHeight - height - M;
    el.style.left = left + 'px';
    el.style.top  = top  + 'px';
  }, [tooltip]);

  if (loading) {
    return (
      <div ref={containerRef} className={`results-chart ${className}`}>
        <h3 className="results-chart-title">ELO distribution</h3>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }
  if (!data?.length) return null;

  const COL_W      = 44;
  const MAX_HALF_W = 10;
  const PAD        = { top: 24, right: 24, bottom: 144, left: 58 };
  const INNER_H    = 480;

  const usablePx = containerWidth > 0
    ? containerWidth - PAD.left - PAD.right - 4
    : data.length * COL_W;
  const maxItems = Math.max(1, Math.floor(usablePx / COL_W));

  let visibleData;
  let skippedMiddle = false;
  let skippedCount  = 0;
  if (maxItems >= data.length) {
    visibleData = data;
  } else {
    // Show lowest and highest halves; skip the middle
    const half  = Math.floor(maxItems / 2);
    const left  = data.slice(0, half);
    const right = data.slice(data.length - (maxItems - half));
    visibleData   = [...left, ...right];
    skippedCount  = data.length - visibleData.length;
    skippedMiddle = true;
  }

  const INNER_W = visibleData.length * COL_W;
  const SVG_W   = PAD.left + INNER_W + PAD.right;
  const SVG_H   = PAD.top  + INNER_H + PAD.bottom;

  const allVals = visibleData.flatMap((d) => d.values);
  const rawMin  = Math.min(...allVals);
  const rawMax  = Math.max(...allVals);
  const yPad    = (rawMax - rawMin) * 0.08;
  const yMin    = rawMin - yPad;
  const yMax    = rawMax + yPad;
  const toY     = (v) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * INNER_H;
  const toX     = (i) => PAD.left + (i + 0.5) * COL_W;

  const step      = Math.ceil((yMax - yMin) / 6 / 100) * 100;
  const tickStart = Math.ceil(yMin / step) * step;
  const yTicks    = [];
  for (let t = tickStart; t <= yMax; t += step) yTicks.push(t);

  const VIOLIN_CLR = 'rgba(255,149,0,0.15)';
  const VIOLIN_STR = 'rgba(255,149,0,0.45)';
  const STEM_CLR   = 'rgba(255,149,0,0.90)';
  const HOVER_CLR  = '#FF9500';
  const hoveredIdx = tooltip ? visibleData.findIndex((d) => d.filename === tooltip.filename) : -1;

  const KDE_PTS   = 80;
  const kdePoints = Array.from({ length: KDE_PTS }, (_, k) =>
    yMin + (k / (KDE_PTS - 1)) * (yMax - yMin)
  );

  return (
    <div ref={containerRef} className={`results-chart ${className}`}>
      <h3 className="results-chart-title">
        ELO distribution &middot; {nReplays} replays
        {skippedMiddle ? ` · ${visibleData.length} of ${data.length} shown (lowest & highest)` : ''}
        {imgLimit > 0 ? ` · top ${imgLimit} images` : ''}
      </h3>
      <div>
        <div style={{ position: 'relative' }}>
          <svg
            width={SVG_W}
            height={SVG_H}
            style={{ display: 'block' }}
            onMouseLeave={() => setTooltip(null)}
          >
            {yTicks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left} y1={toY(t)}
                  x2={PAD.left + INNER_W} y2={toY(t)}
                  stroke="rgba(255,255,255,0.07)" strokeWidth={1}
                />
                <text
                  x={PAD.left - 6} y={toY(t) + 4}
                  fontSize={11} textAnchor="end"
                  fill="rgba(226,232,240,0.38)"
                  style={{ fontFamily: 'inherit' }}
                >{t}</text>
              </g>
            ))}

            {(() => {
              const splitAt = skippedMiddle ? Math.floor(maxItems / 2) : -1;
              return visibleData.map((d, i) => {
                const showGap = i === splitAt;
                const gapX    = PAD.left + i * COL_W;
                const cx      = toX(i);
                const isHover = i === hoveredIdx;
                const fillC   = isHover ? 'rgba(255,149,0,0.35)' : VIOLIN_CLR;
                const stroC   = isHover ? HOVER_CLR : VIOLIN_STR;
                const stemC   = isHover ? HOVER_CLR : STEM_CLR;

                const bw      = Math.max(1, silverman(d.values));
                const density = kde(d.values, kdePoints, bw);
                const maxD    = Math.max(...density);
                const hw      = (v) => maxD > 0 ? (v / maxD) * MAX_HALF_W : 0;

                // Mirrored violin path: right side top→bottom, left side bottom→top
                const right = kdePoints.map((p, k) => `${cx + hw(density[k])},${toY(p)}`);
                const left  = [...kdePoints].reverse().map((p, k) =>
                  `${cx - hw(density[kdePoints.length - 1 - k])},${toY(p)}`
                );
                const pathD = `M ${right[0]} L ${right.join(' L ')} L ${left.join(' L ')} Z`;

                return (
                  <g key={d.filename}>
                    {showGap && (
                      <g>
                        <rect
                          x={gapX - COL_W * 0.35} y={PAD.top}
                          width={COL_W * 0.7} height={INNER_H}
                          fill="rgba(255,255,255,0.03)"
                        />
                        <line
                          x1={gapX} y1={PAD.top}
                          x2={gapX} y2={PAD.top + INNER_H}
                          stroke="rgba(255,255,255,0.50)" strokeWidth={1.5} strokeDasharray="5 4"
                        />
                        <text
                          x={gapX} y={PAD.top - 8}
                          fontSize={12} fill="rgba(226,232,240,0.70)"
                          style={{ fontFamily: 'inherit' }}
                          textAnchor="middle"
                        >{skippedCount} omitted</text>
                      </g>
                    )}
                    <g
                      onMouseMove={(e) => setTooltip({ ...d, x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setTooltip(null)}
                      style={{ cursor: 'default' }}
                    >
                      <line
                        x1={cx} y1={toY(d.min)}
                        x2={cx} y2={toY(d.max)}
                        stroke={stemC} strokeWidth={1.5}
                      />
                      <path d={pathD} fill={fillC} stroke={stroC} strokeWidth={1} />
                      <line x1={cx - 5} y1={toY(d.q1)} x2={cx + 5} y2={toY(d.q1)} stroke={stemC} strokeWidth={1.5} />
                      <line x1={cx - 5} y1={toY(d.q3)} x2={cx + 5} y2={toY(d.q3)} stroke={stemC} strokeWidth={1.5} />
                      <line
                        x1={cx - 6} y1={toY(d.mean)}
                        x2={cx + 6} y2={toY(d.mean)}
                        stroke={stemC} strokeWidth={2}
                      />
                    </g>
                  </g>
                );
              });
            })()}

            {visibleData.map((d, i) => {
              const label = d.name.length > 22 ? d.name.slice(0, 21) + '\u2026' : d.name;
              return (
                <text
                  key={d.filename}
                  fontSize={11}
                  fill="rgba(226,232,240,0.50)"
                  textAnchor="end"
                  style={{ fontFamily: 'inherit' }}
                  transform={`translate(${toX(i) + 3},${PAD.top + INNER_H + 8}) rotate(-65)`}
                >{label}</text>
              );
            })}

            <text
              x={13} y={PAD.top + INNER_H / 2}
              fontSize={10} textAnchor="middle"
              fill="rgba(226,232,240,0.38)"
              style={{ fontFamily: 'inherit' }}
              transform={`rotate(-90,13,${PAD.top + INNER_H / 2})`}
            >ELO rating</text>
          </svg>

          {tooltip && (
            <div
              ref={tooltipRef}
              className="scatter-tooltip"
              style={{ left: tooltip.x + 16, top: tooltip.y - 40 }}
            >
              <img
                src={previewSrc(tooltip.filename)}
                onError={(e) => { e.currentTarget.src = `/images/${tooltip.filename}`; }}
                alt={tooltip.name}
                className="scatter-tooltip-img"
              />
              <div className="scatter-tooltip-body">
                <p className="scatter-tooltip-name">{tooltip.name}</p>
                <p className="scatter-tooltip-stat">
                  <span style={{ color: 'var(--accent)' }}>{tooltip.mean}</span>
                  {' mean · '}{tooltip.min}–{tooltip.max} range
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
