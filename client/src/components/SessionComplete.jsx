export default function SessionComplete({ sessionCount, onRestart, bridge = false }) {
  return (
    <div className="session-complete-screen">
      <div className="modal-card" role="dialog" aria-modal="true">
        <p className="modal-app-title">{bridge ? 'Bridge complete' : 'Round complete'}</p>
        <div className="session-complete-stat">
          <span className="session-complete-count">{sessionCount}</span>
          {' '}
          <span className="session-complete-count-label">comparisons made</span>
        </div>
        <p className="session-complete-subtitle">
          {bridge
            ? 'Thank you — all available bridge comparisons are done.'
            : 'Thank you for your submission.'}
        </p>
        <button className="session-complete-btn" onClick={onRestart}>
          {bridge ? 'Check for more' : 'Start new round'}
        </button>
      </div>
    </div>
  );
}
