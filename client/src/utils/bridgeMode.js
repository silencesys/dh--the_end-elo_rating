/**
 * Bridge mode (?source=bridge).
 *
 * Drives the existing compare UI from the server bridge queue (M3's
 * GET /api/bridge/next) instead of the local pair scheduler. Only the *source of
 * the next pair* changes — CompareView, the timer, and POST /api/compare are
 * untouched, so bridge votes are recorded as ordinary comparisons tagged with the
 * session's source='bridge'.
 */

/** True when the page was opened with ?source=bridge. */
export function isBridgeMode(search = window.location.search) {
  return new URLSearchParams(search).get('source') === 'bridge';
}

/**
 * Fetch the next bridge pair for this session.
 * The endpoint already returns images shaped as { _id, filename, name, width,
 * height } — exactly what CompareView consumes — so no mapping is needed.
 *
 * @param {string|null} sessionId - excludes pairs already rated in this session.
 * @returns {Promise<{ pair: object[]|null, done: boolean, band?: string }>}
 *   `done:true` when the queue is exhausted; on a network error returns
 *   `{ pair:null, done:false }` so we don't falsely show the complete screen.
 */
export async function fetchBridgePair(sessionId) {
  const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  try {
    const res = await fetch(`/api/bridge/next${qs}`);
    const data = await res.json();
    if (data && data.done) return { pair: null, done: true };
    if (!data || !Array.isArray(data.pair)) return { pair: null, done: false };
    return { pair: data.pair, done: false, band: data.band };
  } catch (err) {
    console.error('Failed to fetch bridge pair:', err);
    return { pair: null, done: false };
  }
}
