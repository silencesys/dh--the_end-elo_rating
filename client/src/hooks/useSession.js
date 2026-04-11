import { useState, useRef, useCallback } from 'react';

/**
 * Manages the server-side Session document lifecycle.
 *
 * - openSession(name)  → POST /api/sessions, stores sessionId + start time
 * - closeSession(sid)  → PATCH /api/sessions/:id/complete with wall-clock duration
 */
export function useSession() {
  const [sessionId, setSessionId] = useState(null);
  const sessionStartRef = useRef(null);

  const openSession = useCallback(async (name) => {
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name }),
      });
      const data = await res.json();
      const sid = data.sessionId ?? null;
      setSessionId(sid);
      sessionStartRef.current = Date.now();
      return sid;
    } catch (err) {
      console.error('Failed to open session:', err);
      return null;
    }
  }, []);

  const closeSession = useCallback((sid) => {
    if (!sid || !sessionStartRef.current) return;
    const durationMs = Date.now() - sessionStartRef.current;
    fetch(`/api/sessions/${sid}/complete`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ durationMs }),
    }).catch((err) => console.error('Failed to close session:', err));
    sessionStartRef.current = null;
  }, []);

  return { sessionId, openSession, closeSession };
}
