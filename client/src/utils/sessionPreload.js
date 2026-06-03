import {
  getPairKey,
  pickNextPair,
  picksSinceAnchorPairAfterSelect,
} from './pairSelection.js';
import { preloadImages, isLoaded } from './preload.js';

/** Minimum pairs to decode before the first ranking screen (includes the first trial). */
export const MIN_INITIAL_PAIRS = 4;

export function imageUrlsForPair(pair) {
  return [`/images/${pair[0].filename}`, `/images/${pair[1].filename}`];
}

export function urlsForPairs(pairs) {
  const urls = new Set();
  for (const pair of pairs) {
    for (const url of imageUrlsForPair(pair)) urls.add(url);
  }
  return [...urls];
}

export function pairsAreReady(pairs) {
  return pairs.every((pair) => imageUrlsForPair(pair).every(isLoaded));
}

/**
 * How many pairs to warm up for a new session (first trial + look-ahead queue).
 */
export function initialWarmupPairCount(preloadCount = 6) {
  const ahead = preloadCount > 0 ? preloadCount : 6;
  return Math.max(MIN_INITIAL_PAIRS, ahead + 1);
}

/**
 * Simulate the next `count` pairs using the same rules as live pair selection.
 */
export function simulateUpcomingPairs(
  images,
  {
    firstPair = null,
    ratedPairIds = new Set(),
    lastShownIds = [],
    picksSinceAnchorPair = 0,
    count = 6,
  } = {}
) {
  const pairs = firstPair ? [firstPair] : [];

  let simRated = new Set(ratedPairIds);
  let simLast = lastShownIds;
  let simPicks = picksSinceAnchorPair;

  if (firstPair) {
    simRated.add(getPairKey(firstPair[0]._id, firstPair[1]._id));
    simLast = [String(firstPair[0]._id), String(firstPair[1]._id)];
    simPicks = picksSinceAnchorPairAfterSelect(firstPair, 0);
  }

  const need = count - pairs.length;
  for (let i = 0; i < need; i++) {
    const ahead = pickNextPair(images, simRated, simLast, simPicks);
    if (!ahead) break;
    pairs.push(ahead);
    simRated.add(getPairKey(ahead[0]._id, ahead[1]._id));
    simLast = [String(ahead[0]._id), String(ahead[1]._id)];
    simPicks = picksSinceAnchorPairAfterSelect(ahead, simPicks);
  }

  return pairs;
}

/**
 * Preload a known first pair plus the simulated look-ahead queue.
 */
export async function preloadFromFirstPair(images, firstPair, preloadCount = 6) {
  if (!firstPair) {
    return { firstPair: null, pairs: [], ready: true };
  }

  const count = initialWarmupPairCount(preloadCount);
  const pairs = simulateUpcomingPairs(images, { firstPair, count });
  await preloadImages(urlsForPairs(pairs));

  return {
    firstPair,
    pairs,
    ready: pairsAreReady(pairs),
  };
}

/**
 * Pick the first pair and preload the full initial session queue.
 */
export async function preloadInitialSession(images, preloadCount = 6) {
  const firstPair = pickNextPair(images, new Set(), [], 0);
  return preloadFromFirstPair(images, firstPair, preloadCount);
}

/**
 * Preload look-ahead pairs after the current trial (fire-and-forget).
 */
export function preloadLookahead(
  images,
  {
    currentPair,
    ratedPairIds,
    lastShownIds,
    picksSinceAnchorPair,
    preloadCount = 6,
  }
) {
  if (!currentPair || !images.length || preloadCount === 0) return;

  const pairs = simulateUpcomingPairs(images, {
    ratedPairIds: new Set([
      ...ratedPairIds,
      getPairKey(currentPair[0]._id, currentPair[1]._id),
    ]),
    lastShownIds: [
      String(currentPair[0]._id),
      String(currentPair[1]._id),
    ],
    picksSinceAnchorPair: picksSinceAnchorPairAfterSelect(
      currentPair,
      picksSinceAnchorPair
    ),
    count: preloadCount,
  });

  preloadImages(urlsForPairs(pairs));
}
