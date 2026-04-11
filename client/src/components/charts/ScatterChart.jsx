import { useState, useEffect, useRef } from 'react';
import { previewSrc, winRate } from '../../utils/imageUtils';

export default function ScatterChart({ images, className = '' }) {
  const W   = 900;
  const H   = 300;
  const PAD = { top: 16, right: 28, bottom: 36, left: 48 };
  const iW  = W - PAD.left - PAD.right;
  const iH  = H - PAD.top  - PAD.bottom;

  const [tooltip, setTooltip] = useState(null);
  const tooltipRef = useRef(null);

  useEffect(() => {
    if (!tooltip || !tooltipRef.current) return;
    const el = tooltipRef.current;
    const { width, height } = el.getBoundingClientRect();
    const MARGIN = 8;
    let left = tooltip.x + 16;
    let top  = tooltip.y - height - 12;
    if (left + width  > window.innerWidth  - MARGIN) left = tooltip.x - width - 12;
    if (top            < MARGIN)                      top  = tooltip.y + 16;
    if (top + height   > window.innerHeight - MARGIN) top  = window.innerHeight - height - MARGIN;
    el.style.left = left + 'px';
    el.style.top  = top  + 'px';
  }, [tooltip]);

  const withData = images.filter((img) => img.comparisons > 0);
  if (withData.length < 2) return null;

  const eloMin   = Math.min(...withData.map((i) => i.eloRating));
  const eloMax   = Math.max(...withData.map((i) => i.eloRating));
  const eloRange = eloMax - eloMin || 1;

  const toX = (elo) => PAD.left + ((elo - eloMin) / eloRange) * iW;
  const toY = (pct) => PAD.top  + (1 - pct / 100) * iH;

  const xTicks = 4;
  const yTicks = [0, 25, 50, 75, 100];

  return (
    <div className={`results-chart ${className}`}>
      <h3 className="results-chart-title">ELO vs win rate</h3>
      <div className="results-chart-scroll">
        <div style={{ position: 'relative' }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            style={{ display: 'block' }}
            onMouseLeave={() => setTooltip(null)}
          >
            {yTicks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left} x2={PAD.left + iW}
                  y1={toY(t)} y2={toY(t)}
                  stroke="rgba(255,255,255,0.07)" strokeWidth={1}
                />
                <text
                  x={PAD.left - 6} y={toY(t) + 4}
                  fontSize={10} textAnchor="end"
                  fill="rgba(226,232,240,0.38)" style={{ fontFamily: 'inherit' }}
                >{t}%</text>
              </g>
            ))}

            {Array.from({ length: xTicks + 1 }, (_, k) => {
              const elo = eloMin + (k / xTicks) * eloRange;
              const x   = toX(elo);
              return (
                <g key={k}>
                  <line
                    x1={x} x2={x}
                    y1={PAD.top} y2={PAD.top + iH}
                    stroke="rgba(255,255,255,0.07)" strokeWidth={1}
                  />
                  <text
                    x={x} y={PAD.top + iH + 16}
                    fontSize={10} textAnchor="middle"
                    fill="rgba(226,232,240,0.38)" style={{ fontFamily: 'inherit' }}
                  >{Math.round(elo)}</text>
                </g>
              );
            })}

            {withData.map((img) => {
              const cx       = toX(img.eloRating);
              const cy       = toY(parseFloat(winRate(img)));
              const R        = 14;
              const isActive = tooltip?.img._id === img._id;
              return (
                <g
                  key={img._id}
                  style={{ cursor: 'default' }}
                  onMouseMove={(e) => setTooltip({ img, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setTooltip(null)}
                >
                  <image
                    href={previewSrc(img.filename)}
                    x={cx - R} y={cy - R}
                    width={R * 2} height={R * 2}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#sc-${img._id})`}
                    style={{ opacity: isActive ? 1 : 0.85 }}
                  />
                  <clipPath id={`sc-${img._id}`}>
                    <circle cx={cx} cy={cy} r={R} />
                  </clipPath>
                  <circle
                    cx={cx} cy={cy} r={isActive ? R + 2 : R}
                    fill="none"
                    stroke={isActive ? 'rgba(255,149,0,0.9)' : 'rgba(255,255,255,0.25)'}
                    strokeWidth={isActive ? 2 : 1.5}
                  />
                </g>
              );
            })}

            <text
              x={PAD.left + iW / 2} y={H - 2}
              fontSize={10} textAnchor="middle"
              fill="rgba(226,232,240,0.38)" style={{ fontFamily: 'inherit' }}
            >ELO rating</text>
            <text
              x={10} y={PAD.top + iH / 2}
              fontSize={10} textAnchor="middle"
              fill="rgba(226,232,240,0.38)" style={{ fontFamily: 'inherit' }}
              transform={`rotate(-90, 10, ${PAD.top + iH / 2})`}
            >Win %</text>
          </svg>

          {tooltip && (
            <div
              ref={tooltipRef}
              className="scatter-tooltip"
              style={{ left: tooltip.x + 16, top: tooltip.y - 74 }}
            >
              <img
                src={previewSrc(tooltip.img.filename)}
                onError={(e) => { e.currentTarget.src = `/images/${tooltip.img.filename}`; }}
                alt={tooltip.img.name}
                className="scatter-tooltip-img"
              />
              <div className="scatter-tooltip-body">
                <p className="scatter-tooltip-name">{tooltip.img.name}</p>
                <p className="scatter-tooltip-stat">
                  <span style={{ color: 'var(--accent)' }}>{Math.round(tooltip.img.eloRating)}</span>
                  {' ELO · '}
                  {winRate(tooltip.img)}{tooltip.img.comparisons > 0 ? '%' : ''} win
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
