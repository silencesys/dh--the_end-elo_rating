export default function HamburgerMenu({ isOpen, onToggle, timerState }) {
  const { timeLeft, total, active } = timerState ?? {
    timeLeft: 0,
    total: 1,
    active: false,
  };

  const SIZE   = 44;
  const STROKE = 3;
  const R      = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * R;

  const pct    = active ? Math.max(0, timeLeft / total) : 1;
  const offset = circumference * (1 - pct);
  const color  =
    !active      ? 'rgba(255,255,255,0.25)' :
    pct > 0.5    ? 'var(--timer-ok)'         :
    pct > 0.2    ? 'var(--timer-warn)'        :
                   'var(--timer-danger)';

  const s     = (active ? timeLeft : total) / 1000;
  const label = s < 10 ? s.toFixed(1) : Math.ceil(s).toString();

  return (
    <div className="hamburger-wrapper">
      <button
        className="hamburger-btn"
        onClick={onToggle}
        aria-label={isOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={isOpen}
      >
        <span className="hamburger-lines" aria-hidden="true">
          <span className="hamburger-line" />
          <span className="hamburger-line" />
          <span className="hamburger-line" />
        </span>
        <span className="hamburger-timer-label" aria-hidden="true" style={{ color }}>
          {label}
        </span>
      </button>

      <svg
        className="hamburger-ring"
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden="true"
      >
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={R}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={R}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{ transition: 'stroke-dashoffset 0.05s linear, stroke 0.5s ease' }}
        />
      </svg>
    </div>
  );
}
