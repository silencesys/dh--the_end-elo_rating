export default function Sidebar({ isOpen, onClose, username, sessionCount, totalPairs, timePerComparison, question }) {
  const progressPct = totalPairs > 0 ? Math.min((sessionCount / totalPairs) * 100, 100) : 0;
  const initial = username ? username.charAt(0).toUpperCase() : '?';

  return (
    <>
      {isOpen && (
        <div className="sidebar-backdrop" onClick={onClose} aria-hidden="true" />
      )}
      <aside className={`sidebar${isOpen ? ' open' : ''}`} aria-hidden={!isOpen}>

        <div className="sidebar-user">
          <div className="sidebar-avatar" aria-hidden="true">{initial}</div>
          <span className="sidebar-username" title={username}>{username}</span>
        </div>

        {question && (
          <>
            <hr className="sidebar-divider" />
            <p className="sidebar-label">Question</p>
            <p className="sidebar-question">{question}</p>
          </>
        )}

        <hr className="sidebar-divider sidebar-divider--mt" />

        <p className="sidebar-label">Progress</p>
        <div
          className="sidebar-progress-bar-track"
          role="progressbar"
          aria-valuenow={sessionCount}
          aria-valuemax={totalPairs}
        >
          <div
            className="sidebar-progress-bar-fill"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="sidebar-progress-text">
          {sessionCount} / {totalPairs} pairs compared
        </p>

        <hr className="sidebar-divider sidebar-divider--mt" />

        <p className="sidebar-label">How it works</p>
        <ul className="sidebar-instructions">
          <li>Two images appear side by side — click the one that best fits the question.</li>
          <li>You have {timePerComparison ? (timePerComparison / 1000).toFixed(0) : '—'} seconds per pair. If time runs out, the pair is skipped automatically.</li>
        </ul>
      </aside>
    </>
  );
}
