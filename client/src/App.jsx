import { useState, useEffect, useCallback, useRef } from 'react';
import LoginModal from './components/LoginModal.jsx';
import Sidebar from './components/Sidebar.jsx';
import CompareView from './components/CompareView.jsx';
import SessionComplete from './components/SessionComplete.jsx';
import HamburgerMenu from './components/HamburgerMenu.jsx';
import { useAppData } from './hooks/useAppData.js';
import { useSession } from './hooks/useSession.js';
import { getPairKey, pickNextPair } from './utils/pairSelection.js';
import { preloadImages } from './utils/preload.js';

export default function App() {
  const { images, setImages, config, loading, error, refreshImages } = useAppData();
  const { sessionId, openSession, closeSession } = useSession();

  const [username, setUsername] = useState(null);
  const [timerState, setTimerState] = useState({ timeLeft: 0, total: 5000, active: false });

  const [currentPair, setCurrentPair] = useState(null);
  const [ratedPairIds, setRatedPairIds] = useState(new Set());
  const [lastShownIds, setLastShownIds] = useState([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [firstPairReady, setFirstPairReady] = useState(false);

  const sessionIdRef = useRef(sessionId);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  useEffect(() => {
    setTimerState((prev) => ({ ...prev, total: config.timePerComparison }));
  }, [config.timePerComparison]);

  useEffect(() => {
    if (!images.length) return;
    const urls = images.map((img) => `/images/${img.filename}`);
    const count = config.preloadCount ?? 6;
    preloadImages(count > 0 ? urls.slice(0, count) : urls);
  }, [images, config.preloadCount]);

  const startSession = useCallback(() => {
    const emptyRated = new Set();
    const noLast = [];
    const first = pickNextPair(images, emptyRated, noLast);
    setRatedPairIds(emptyRated);
    setLastShownIds(noLast);
    setSessionCount(0);
    setSessionComplete(false);
    setFirstPairReady(false);
    setCurrentPair(first);
    openSession(username);
  }, [images, username, openSession]);

  useEffect(() => {
    if (!currentPair || firstPairReady) return;
    preloadImages([
      `/images/${currentPair[0].filename}`,
      `/images/${currentPair[1].filename}`,
    ]).then(() => setFirstPairReady(true));
  }, [currentPair, firstPairReady]);


  useEffect(() => {
    if (!currentPair || !images.length) return;
    const count = config.preloadCount ?? 6;
    if (count === 0) return;

    let simRated = new Set(ratedPairIds);
    simRated.add(getPairKey(currentPair[0]._id, currentPair[1]._id));
    let simLast = [String(currentPair[0]._id), String(currentPair[1]._id)];

    for (let i = 0; i < count; i++) {
      const ahead = pickNextPair(images, simRated, simLast);
      if (!ahead) break;
      preloadImages([
        `/images/${ahead[0].filename}`,
        `/images/${ahead[1].filename}`,
      ]);
      simRated.add(getPairKey(ahead[0]._id, ahead[1]._id));
      simLast = [String(ahead[0]._id), String(ahead[1]._id)];
    }
  }, [currentPair, images, ratedPairIds, config.preloadCount]);

  const handleLogin = useCallback(
    async (name, introShownIds = []) => {
      setUsername(name);
      const emptyRated = new Set();
      const first = pickNextPair(images, emptyRated, introShownIds);
      setRatedPairIds(emptyRated);
      setLastShownIds(introShownIds);
      setSessionCount(0);
      setSessionComplete(false);
      setFirstPairReady(false);
      setCurrentPair(first);
      await openSession(name);
    },
    [images, openSession]
  );

  const handleCompare = useCallback(
    async (winnerId, loserId, skipped, meta = {}) => {
      const key = getPairKey(winnerId, loserId);
      const newRated = new Set(ratedPairIds);
      newRated.add(key);

      const newLastShown = [String(winnerId), String(loserId)];
      const newCount = sessionCount + 1;

      const updatedImages = skipped ? images : images.map((img) => {
        if (String(img._id) === String(winnerId))
          return { ...img, comparisons: img.comparisons + 1, wins: img.wins + 1 };
        if (String(img._id) === String(loserId))
          return { ...img, comparisons: img.comparisons + 1 };
        return img;
      });
      if (!skipped) setImages(updatedImages);

      const atLimit = config.sessionPairsLimit > 0 && newCount >= config.sessionPairsLimit;
      const nextPair = atLimit ? null : pickNextPair(updatedImages, newRated, newLastShown);
      const isLast = !nextPair;

      setRatedPairIds(newRated);
      setLastShownIds(newLastShown);
      setSessionCount(newCount);
      setCurrentPair(nextPair);
      setSessionComplete(isLast);

      const sid = sessionIdRef.current;

      if (skipped) {
        if (sid) {
          fetch(`/api/sessions/${sid}/skip`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ winnerId, loserId, ...meta }),
          }).catch((err) => console.error('Failed to log skip:', err));
        }
      } else {
        fetch('/api/compare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ winnerId, loserId, username, sessionId: sid, ...meta }),
        })
          .then((r) => r.json())
          .then((result) => {
            // Server returns batch-recomputed ELO for all images.
            // Apply the updated ratings immediately into local state so
            // cards and charts reflect the true post-recompute values.
            if (result?.winner && result?.loser) {
              setImages((prev) => prev.map((img) => {
                const id = String(img._id);
                if (id === String(result.winner.id))
                  return { ...img, eloRating: result.winner.eloRating };
                if (id === String(result.loser.id))
                  return { ...img, eloRating: result.loser.eloRating };
                return img;
              }));
            }
            // Full refresh to pick up all other images' recomputed ratings
            refreshImages();
          })
          .catch((err) => console.error('Failed to save comparison:', err));
      }

      if (isLast) closeSession(sid);
    },
    [ratedPairIds, images, sessionCount, config.sessionPairsLimit, username, closeSession, refreshImages]
  );

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

  if (!username) {
    return <LoginModal config={config} images={images} onLogin={handleLogin} />;
  }

  // Hold the loading screen until the very first pair is fully preloaded.
  // On fast networks this is imperceptibly brief; on slow ones it prevents
  // showing a blank/flicker on that first trial.
  if (!firstPairReady) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
      </div>
    );
  }

  const totalPairs = (images.length * (images.length - 1)) / 2;
  const effectivePairs = config.sessionPairsLimit > 0
    ? Math.min(config.sessionPairsLimit, totalPairs)
    : totalPairs;

  return (
    <div className="app-layout">
      <HamburgerMenu
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        timerState={timerState}
      />
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        username={username}
        sessionCount={sessionCount}
        totalPairs={effectivePairs}
        timePerComparison={config.timePerComparison}
        question={config.question}
      />
      <main className="main-content">
        <CompareView
          pair={currentPair}
          timePerComparison={config.timePerComparison}
          onCompare={handleCompare}
          onTimerChange={setTimerState}
        />
      </main>
      {sessionComplete && (
        <SessionComplete
          sessionCount={sessionCount}
          onRestart={startSession}
        />
      )}
    </div>
  );
}
