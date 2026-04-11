import { previewSrc } from '../../utils/imageUtils';

export default function BarChart({ images, valueKey, label, formatValue, accent = '#FF9500', distByFilename = null, className = '' }) {
  const sorted = [...images].sort((a, b) => b[valueKey] - a[valueKey]);
  const max = sorted[0]?.[valueKey] ?? 1;

  const ROW_H       = 24;
  const THUMB_W     = ROW_H;
  const FS_LABEL    = 11;
  const FS_VALUE    = 11;
  const FS_RANGE    = 9;
  const LABEL_W     = 120;
  const GAP_LABEL   = 20;
  const BAR_MAX     = 340;
  const BAR_TRACK_H = 14;
  const GAP_VALUE   = 20;
  const VALUE_W     = 96;
  const ROW_GAP     = 8;

  const SVG_W = LABEL_W + GAP_LABEL + BAR_MAX + GAP_VALUE + VALUE_W;
  const H     = sorted.length * (ROW_H + ROW_GAP);
  const BAR_X = LABEL_W + GAP_LABEL;
  const toBarX = (v) => Math.min(BAR_X + BAR_MAX, Math.max(BAR_X, BAR_X + (v / max) * BAR_MAX));

  return (
    <div className={`results-chart ${className}`}>
      <h3 className="results-chart-title">{label}</h3>
      <div className="results-chart-scroll">
        <svg viewBox={`0 0 ${SVG_W} ${H}`} width="100%" style={{ display: 'block' }}>
          {sorted.map((img, i) => {
            const y      = i * (ROW_H + ROW_GAP);
            const cy     = y + ROW_H / 2;
            const barW   = Math.max(2, (img[valueKey] / max) * BAR_MAX);
            const isTop3 = i < 3;
            return (
              <g key={img._id}>
                <image
                  href={previewSrc(img.filename)}
                  x={0} y={y}
                  width={THUMB_W} height={THUMB_W}
                  preserveAspectRatio="xMidYMid slice"
                  clipPath={`url(#clip-${valueKey}-${img._id})`}
                />
                <clipPath id={`clip-${valueKey}-${img._id}`}>
                  <rect x={0} y={y} width={THUMB_W} height={THUMB_W} rx={4} />
                </clipPath>

                <text
                  x={THUMB_W + 8} y={cy + FS_LABEL * 0.35}
                  fontSize={FS_LABEL} fill="rgba(226,232,240,0.70)"
                  style={{ fontFamily: 'inherit' }}
                >
                  {img.name.length > 18 ? img.name.slice(0, 17) + '…' : img.name}
                </text>

                <rect
                  x={BAR_X} y={cy - BAR_TRACK_H / 2}
                  width={BAR_MAX} height={BAR_TRACK_H}
                  rx={4} fill="rgba(255,255,255,0.06)"
                />
                <rect
                  x={BAR_X} y={cy - BAR_TRACK_H / 2}
                  width={barW} height={BAR_TRACK_H}
                  rx={4} fill="rgba(255,255,255,0.22)" opacity={isTop3 ? 1 : 0.7}
                />

                <text
                  x={BAR_X + BAR_MAX + GAP_VALUE}
                  y={cy + (distByFilename?.[img.filename] ? FS_VALUE * -0.15 : FS_VALUE * 0.35)}
                  fontSize={FS_VALUE} fontWeight={isTop3 ? 700 : 400}
                  fill={isTop3 ? accent : 'rgba(226,232,240,0.55)'}
                  style={{ fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatValue(img)}
                </text>

                {distByFilename?.[img.filename] && (
                  <text
                    x={BAR_X + BAR_MAX + GAP_VALUE}
                    y={cy + FS_VALUE * 0.85}
                    fontSize={FS_RANGE} fill="rgba(226,232,240,0.38)"
                    style={{ fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {distByFilename[img.filename].min}–{distByFilename[img.filename].max}
                  </text>
                )}

                {distByFilename && (() => {
                  const ci = distByFilename[img.filename];
                  if (!ci) return null;
                  const minX = toBarX(ci.min);
                  const maxX = toBarX(ci.max);
                  const q1X  = toBarX(ci.q1);
                  const q3X  = toBarX(ci.q3);
                  const capH = BAR_TRACK_H / 2;
                  return (
                    <g>
                      <line x1={minX} y1={cy} x2={maxX} y2={cy}
                        stroke="rgba(255,255,255,0.28)" strokeWidth={1.5} />
                      <line x1={minX} y1={cy - capH} x2={minX} y2={cy + capH}
                        stroke="rgba(255,255,255,0.28)" strokeWidth={1} />
                      <line x1={maxX} y1={cy - capH} x2={maxX} y2={cy + capH}
                        stroke="rgba(255,255,255,0.28)" strokeWidth={1} />
                      <rect
                        x={q1X} y={cy - capH}
                        width={Math.max(1, q3X - q1X)} height={BAR_TRACK_H}
                        rx={2} fill="rgba(255,149,0,0.45)"
                        stroke="rgba(255,149,0,0.80)" strokeWidth={1}
                      />
                    </g>
                  );
                })()}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
