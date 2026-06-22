import { useState, useEffect, useCallback, useRef } from 'react';
import LoginModal from './components/LoginModal.jsx';
import Sidebar from './components/Sidebar.jsx';
import CompareView from './components/CompareView.jsx';
import SessionComplete from './components/SessionComplete.jsx';
import HamburgerMenu from './components/HamburgerMenu.jsx';
import { useAppData } from './hooks/useAppData.js';
import { useSession } from './hooks/useSession.js';
import {
  getPairKey,
  pickNextPair,
  advancePicksSinceAnchorPair,
  picksSinceAnchorPairAfterSelect,
} from './utils/pairSelection.js';
import {
  preloadInitialSession,
  preloadFromFirstPair,
  preloadLookahead,
  pairsAreReady,
  imageUrlsForPair,
} from './utils/sessionPreload.js';
import { preloadImages } from './utils/preload.js';
import { isBridgeMode, fetchBridgePair } from './utils/bridgeMode.js';

export default function App() {
  const { images, setImages, config, loading, error, refreshImages } = useAppData();
  const { sessionId, openSession, closeSession } = useSession();

  const [username, setUsername] = useState(null);
  const [bridgeMode] = useState(isBridgeMode);
  const [timerState, setTimerState] = useState({ timeLeft: 0, total: 5000, active: false });

  const [currentPair, setCurrentPair] = useState(null);
  const [ratedPairIds, setRatedPairIds] = useState(new Set());
  const [lastShownIds, setLastShownIds] = useState([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [picksSinceAnchorPair, setPicksSinceAnchorPair] = useState(0);

  const sessionIdRef = useRef(sessionId);
  const loginWarmupRef = useRef(null);
  const warmupGenRef = useRef(0);

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  useEffect(() => {
    setTimerState((prev) => ({ ...prev, total: config.timePerComparison }));
  }, [config.timePerComparison]);

  // While on the login screen, preload the first session queue in the background.
  // Skipped in bridge mode — the first pair comes from the server queue on login.
  useEffect(() => {
    if (loading || username || images.length < 2 || bridgeMode) return;

    const gen = ++warmupGenRef.current;
    loginWarmupRef.current = null;

    preloadInitialSession(images, config.preloadCount).then((plan) => {
      if (warmupGenRef.current !== gen) return;
      loginWarmupRef.current = plan;
    });
  }, [loading, username, images, config.preloadCount, bridgeMode]);

  const beginSession = useCallback(
    async (firstPair, { useWarmupIfMatch = false } = {}) => {
      setSessionReady(false);
      if (!firstPair) return null;

      const warmup = loginWarmupRef.current;
      const warmupMatches =
        useWarmupIfMatch &&
        warmup?.firstPair &&
        getPairKey(warmup.firstPair[0]._id, warmup.firstPair[1]._id) ===
          getPairKey(firstPair[0]._id, firstPair[1]._id) &&
        pairsAreReady(warmup.pairs);

      if (!warmupMatches) {
        const plan = await preloadFromFirstPair(
          images,
          firstPair,
          config.preloadCount
        );
        setSessionReady(plan.ready);
      } else {
        setSessionReady(true);
      }

      setPicksSinceAnchorPair(picksSinceAnchorPairAfterSelect(firstPair, 0));
      setCurrentPair(firstPair);
      return firstPair;
    },
    [images, config.preloadCount]
  );

  // Bridge mode: preload a single server-provided pair (no local look-ahead queue).
  const beginBridgeSession = useCallback(async (pair) => {
    setSessionReady(false);
    if (pair) await preloadImages(imageUrlsForPair(pair));
    setCurrentPair(pair);
    setSessionReady(true);
  }, []);

  const startSession = useCallback(async () => {
    setRatedPairIds(new Set());
    setLastShownIds([]);
    setSessionCount(0);
    setSessionComplete(false);
    loginWarmupRef.current = null;

    if (bridgeMode) {
      const sid = await openSession(username);
      const { pair, done } = await fetchBridgePair(sid);
      await beginBridgeSession(pair);
      setSessionComplete(done);
      return;
    }

    const first = pickNextPair(images, new Set(), [], 0);
    await beginSession(first);
    openSession(username);
  }, [images, username, openSession, beginSession, bridgeMode, beginBridgeSession]);

  useEffect(() => {
    if (!currentPair || !images.length || !sessionReady || bridgeMode) return;

    preloadLookahead(images, {
      currentPair,
      ratedPairIds,
      lastShownIds,
      picksSinceAnchorPair,
      preloadCount: config.preloadCount,
    });
  }, [
    currentPair,
    images,
    ratedPairIds,
    lastShownIds,
    picksSinceAnchorPair,
    config.preloadCount,
    sessionReady,
    bridgeMode,
  ]);

  const handleLogin = useCallback(
    async (name) => {
      setUsername(name);
      setRatedPairIds(new Set());
      setLastShownIds([]);
      setSessionCount(0);
      setSessionComplete(false);

      if (bridgeMode) {
        const sid = await openSession(name);
        const { pair, done } = await fetchBridgePair(sid);
        await beginBridgeSession(pair);
        setSessionComplete(done);
        return;
      }

      const warmup = loginWarmupRef.current;
      const first =
        warmup?.firstPair ?? pickNextPair(images, new Set(), [], 0);

      await beginSession(first, { useWarmupIfMatch: true });
      await openSession(name);
    },
    [images, openSession, beginSession, bridgeMode, beginBridgeSession]
  );

  const handleCompare = useCallback(
    async (winnerId, loserId, skipped, meta = {}) => {
      const newCount = sessionCount + 1;
      const sid = sessionIdRef.current;

      const updatedImages = skipped ? images : images.map((img) => {
        if (String(img._id) === String(winnerId))
          return { ...img, comparisons: img.comparisons + 1, wins: img.wins + 1 };
        if (String(img._id) === String(loserId))
          return { ...img, comparisons: img.comparisons + 1 };
        return img;
      });
      if (!skipped) setImages(updatedImages);
      setSessionCount(newCount);

      // Bridge mode: record the vote, then pull the next pair from the server
      // queue (its quota + this-session exclusion are up to date after the POST).
      // SESSION_PAIRS_LIMIT is ignored; ending is driven by done:true.
      if (bridgeMode) {
        if (skipped) {
          if (sid) {
            await fetch(`/api/sessions/${sid}/skip`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ winnerId, loserId, ...meta }),
            }).catch((err) => console.error('Failed to log skip:', err));
          }
        } else {
          await fetch('/api/compare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ winnerId, loserId, username, sessionId: sid, ...meta }),
          })
            .then((r) => r.json())
            .then((result) => {
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
            })
            .catch((err) => console.error('Failed to save comparison:', err));
        }

        const { pair, done } = await fetchBridgePair(sid);
        if (pair) await preloadImages(imageUrlsForPair(pair));
        setCurrentPair(pair);
        setLastShownIds(pair ? [String(pair[0]._id), String(pair[1]._id)] : []);
        setSessionComplete(done);
        if (done) closeSession(sid);
        return;
      }

      const key = getPairKey(winnerId, loserId);
      const newRated = new Set(ratedPairIds);
      newRated.add(key);

      const newLastShown = [String(winnerId), String(loserId)];

      const atLimit = config.sessionPairsLimit > 0 && newCount >= config.sessionPairsLimit;
      const streakForPick = advancePicksSinceAnchorPair(currentPair, picksSinceAnchorPair);
      const nextPair = atLimit
        ? null
        : pickNextPair(updatedImages, newRated, newLastShown, streakForPick);
      const isLast = !nextPair;

      setRatedPairIds(newRated);
      setLastShownIds(newLastShown);
      setPicksSinceAnchorPair(
        picksSinceAnchorPairAfterSelect(nextPair, streakForPick)
      );
      setCurrentPair(nextPair);
      setSessionComplete(isLast);

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
            refreshImages();
          })
          .catch((err) => console.error('Failed to save comparison:', err));
      }

      if (isLast) closeSession(sid);
    },
    [
      ratedPairIds,
      images,
      sessionCount,
      config.sessionPairsLimit,
      username,
      closeSession,
      refreshImages,
      currentPair,
      picksSinceAnchorPair,
      bridgeMode,
    ]
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

  if (!sessionReady) {
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
          bridge={bridgeMode}
        />
      )}
    </div>
  );
}
