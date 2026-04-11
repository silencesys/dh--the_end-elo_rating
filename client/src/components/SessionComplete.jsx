export default function SessionComplete({ sessionCount, onRestart }) {
  return (
    <div className="session-complete-screen">
      <div className="modal-card" role="dialog" aria-modal="true">
        <p className="modal-app-title">Round complete</p>
        <div className="session-complete-stat">
          <span className="session-complete-count">{sessionCount}</span>
          {' '}
          <span className="session-complete-count-label">comparisons made</span>
        </div>
        <p className="session-complete-subtitle">
          Thank you for your submission.
        </p>
        <button className="session-complete-btn" onClick={onRestart}>
          Start new round
        </button>
      </div>
    </div>
  );
}
