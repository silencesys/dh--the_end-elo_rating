import { useState, useEffect, useRef, useCallback } from 'react';
import { preloadImages, isLoaded } from '../utils/preload.js';

const ITI_MS  = 250;  // blank period between pairs – clears visual memory
const FADE_MS = 80;   // must match CSS transition on .images-container
const SPINNER_DELAY_MS = 600; // avoid spinner flash on fast networks

export default function CompareView({ pair, timePerComparison, onCompare, onTimerChange }) {
  const [displayedPair, setDisplayedPair] = useState(null);
  const [imagesVisible, setImagesVisible] = useState(false);
  const [showSpinner,   setShowSpinner]   = useState(false);
  const [timeLeft,      setTimeLeft]      = useState(timePerComparison);

  const timerRef          = useRef(null);
  const handledRef        = useRef(false);
  const pairRef           = useRef(pair);
  const runIdRef          = useRef(0);       // cancellation token
  const isFirstRef        = useRef(true);    // no ITI on the very first pair
  const onTimerChangeRef  = useRef(onTimerChange);
  const img0Ref           = useRef(null);    // refs to displayed <img> elements
  const img1Ref           = useRef(null);
  const shownAtRef        = useRef(null);    // Date.now() when timer started for this pair

  useEffect(() => { pairRef.current = pair; }, [pair]);
  useEffect(() => { onTimerChangeRef.current = onTimerChange; }, [onTimerChange]);

  // Forward timer state to parent (e.g. HamburgerMenu ring) on every tick.
  useEffect(() => {
    onTimerChangeRef.current?.({ timeLeft, total: timePerComparison, active: imagesVisible });
  }, [timeLeft, imagesVisible, timePerComparison]);

  useEffect(() => {
    if (!pair) return;

    const runId = ++runIdRef.current;
    clearInterval(timerRef.current);
    handledRef.current = false;

    const urls = [
      `/images/${pair[0].filename}`,
      `/images/${pair[1].filename}`,
    ];

    const blankMs = isFirstRef.current ? 0 : ITI_MS;
    isFirstRef.current = false;

    setImagesVisible(false);

    const alreadyReady = urls.every(isLoaded);
    const spinnerTimer = alreadyReady
      ? null
      : setTimeout(() => {
          if (runIdRef.current === runId) setShowSpinner(true);
        }, SPINNER_DELAY_MS);

    Promise.all([
      preloadImages(urls),
      alreadyReady
        ? Promise.resolve()
        : new Promise((r) => setTimeout(r, blankMs + FADE_MS)),
    ]).then(() => {
      if (spinnerTimer) clearTimeout(spinnerTimer);
      if (runIdRef.current !== runId) return;

      setShowSpinner(false);
      setDisplayedPair(pair);
      setTimeLeft(timePerComparison);
    });

    return () => { if (spinnerTimer) clearTimeout(spinnerTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, timePerComparison]);

  useEffect(() => {
    if (!displayedPair) return;
    const runId = runIdRef.current;

    Promise.all([
      img0Ref.current?.decode?.().catch(() => {}),
      img1Ref.current?.decode?.().catch(() => {}),
    ]).then(() => {
      if (runIdRef.current === runId) setImagesVisible(true);
    });
  }, [displayedPair]);

  useEffect(() => {
    if (!imagesVisible) { clearInterval(timerRef.current); return; }

    const startedAt = Date.now();
    shownAtRef.current = startedAt;
    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, timePerComparison - (Date.now() - startedAt));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timerRef.current);
        if (!handledRef.current) handleDecisionRef.current(null);
      }
    }, 50);

    return () => clearInterval(timerRef.current);
  }, [imagesVisible, timePerComparison]);

  const handleDecision = useCallback((side) => {
    if (handledRef.current || !imagesVisible) return;
    handledRef.current = true;
    clearInterval(timerRef.current);

    const p = pairRef.current;
    if (!p) return;

    const thinkingTime = shownAtRef.current ? Date.now() - shownAtRef.current : null;

    if (side !== null) {
      const winner = side === 'left' ? p[0] : p[1];
      const loser  = side === 'left' ? p[1] : p[0];
      onCompare(winner._id, loser._id, false, {
        thinkingTime,
        winnerPosition: side,
        loserPosition:  side === 'left' ? 'right' : 'left',
        isCalibration:  false,
      });
    } else {
      // Timeout — no winner chosen
      onCompare(p[0]._id, p[1]._id, true, {
        thinkingTime,
        winnerPosition: null,
        loserPosition:  null,
        isCalibration:  false,
      });
    }
  }, [imagesVisible, onCompare]);

  const handleDecisionRef = useRef(handleDecision);
  useEffect(() => { handleDecisionRef.current = handleDecision; }, [handleDecision]);

  if (!pair && !displayedPair) {
    return <div className="compare-empty"><p>No images available for comparison.</p></div>;
  }

  return (
    <div className="compare-view">
      {showSpinner && (
        <div className="compare-loading-overlay">
          <div className="spinner" />
        </div>
      )}

      <div className={`images-container${imagesVisible ? '' : ' hidden'}`}>
        {displayedPair && (
          <>
            <div className="image-panel">
              <div
                className="image-clickable"
                style={displayedPair[0].width && displayedPair[0].height
                  ? { aspectRatio: `${displayedPair[0].width} / ${displayedPair[0].height}` }
                  : undefined}
                onClick={() => handleDecision('left')}
                role="button" tabIndex={0}
                aria-label={`Select ${displayedPair[0].name}`}
                onKeyDown={(e) => e.key === 'Enter' && handleDecision('left')}
              >
                <img
                  ref={img0Ref}
                  src={`/images/${displayedPair[0].filename}`}
                  alt={displayedPair[0].name}
                  className="loaded"
                  draggable={false}
                />
              </div>
            </div>
            <div className="image-panel">
              <div
                className="image-clickable"
                style={displayedPair[1].width && displayedPair[1].height
                  ? { aspectRatio: `${displayedPair[1].width} / ${displayedPair[1].height}` }
                  : undefined}
                onClick={() => handleDecision('right')}
                role="button" tabIndex={0}
                aria-label={`Select ${displayedPair[1].name}`}
                onKeyDown={(e) => e.key === 'Enter' && handleDecision('right')}
              >
                <img
                  ref={img1Ref}
                  src={`/images/${displayedPair[1].filename}`}
                  alt={displayedPair[1].name}
                  className="loaded"
                  draggable={false}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
