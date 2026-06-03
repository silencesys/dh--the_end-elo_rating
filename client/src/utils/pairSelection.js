export function getPairKey(id1, id2) {
  return [String(id1), String(id2)].sort().join('|');
}

/** Minimum per-image comparisons before an image is treated as a ranked anchor. */
export const ANCHOR_THRESHOLD = 5;

/** After this many consecutive non-anchor pairs, the next pick must be anchor × anchor. */
export const ANCHOR_PAIR_EVERY = 5;

const LOW_COMP_TOLERANCE = 2;

export function isAnchor(img) {
  return img.comparisons >= ANCHOR_THRESHOLD;
}

export function isAnchorPair(pair) {
  return isAnchor(pair[0]) && isAnchor(pair[1]);
}

/** One cold (under-sampled) image paired with one anchor. */
function isColdAnchorPair(pair) {
  const a = isAnchor(pair[0]);
  const b = isAnchor(pair[1]);
  return (a && !b) || (!a && b);
}

function combinedComparisons(pair) {
  return pair[0].comparisons + pair[1].comparisons;
}

function avoidsLast(pair, lastShownIds) {
  return (
    !lastShownIds.includes(String(pair[0]._id)) &&
    !lastShownIds.includes(String(pair[1]._id))
  );
}

function allUnratedPairs(images, ratedPairIds) {
  const pairs = [];
  for (let i = 0; i < images.length; i++) {
    for (let j = i + 1; j < images.length; j++) {
      const a = images[i];
      const b = images[j];
      if (!ratedPairIds.has(getPairKey(a._id, b._id))) pairs.push([a, b]);
    }
  }
  return pairs;
}

function hasAnchors(images) {
  return images.some(isAnchor);
}

function allImagesAnchored(images) {
  return images.every(isAnchor);
}

function pickFromPool(candidates, lastShownIds) {
  if (!candidates.length) return null;

  const withAvoid = candidates.filter((p) => avoidsLast(p, lastShownIds));
  const pool = withAvoid.length ? withAvoid : candidates;

  pool.sort((a, b) => combinedComparisons(a) - combinedComparisons(b));
  const min = combinedComparisons(pool[0]);
  const lowest = pool.filter(
    (p) => combinedComparisons(p) <= min + LOW_COMP_TOLERANCE
  );

  const pair = lowest[Math.floor(Math.random() * lowest.length)];
  return Math.random() < 0.5 ? pair : [pair[1], pair[0]];
}

/**
 * Update the anchor-pair streak after the participant finishes the current pair.
 */
export function advancePicksSinceAnchorPair(currentPair, picksSinceAnchorPair) {
  if (!currentPair) return picksSinceAnchorPair;
  return isAnchorPair(currentPair) ? 0 : picksSinceAnchorPair + 1;
}

/**
 * Coverage-first pair selection (Option B).
 *
 * - While some images are under-sampled, prefer cold × anchor pairs.
 * - Prefer session-unrated pairs with the lowest combined comparison counts.
 * - Every ANCHOR_PAIR_EVERY picks, require anchor × anchor for recalibration.
 */
export function pickNextPair(
  images,
  ratedPairIds,
  lastShownIds,
  picksSinceAnchorPair = 0
) {
  if (images.length < 2) return null;

  const unrated = allUnratedPairs(images, ratedPairIds);
  if (!unrated.length) return null;

  const anchorPairs = unrated.filter(isAnchorPair);
  const coldAnchorPairs = unrated.filter(isColdAnchorPair);

  const mustAnchorPair =
    picksSinceAnchorPair >= ANCHOR_PAIR_EVERY - 1 && anchorPairs.length > 0;

  let pool;

  if (mustAnchorPair) {
    pool = anchorPairs;
  } else if (!allImagesAnchored(images) && hasAnchors(images)) {
    pool = coldAnchorPairs.length
      ? coldAnchorPairs
      : unrated.filter((p) => isAnchor(p[0]) || isAnchor(p[1]));
    if (!pool.length) pool = unrated;
  } else if (!hasAnchors(images)) {
    pool = unrated;
  } else {
    pool = coldAnchorPairs.length ? coldAnchorPairs : unrated;
  }

  if (!pool.length) pool = anchorPairs.length ? anchorPairs : unrated;

  return pickFromPool(pool, lastShownIds);
}

/**
 * Streak value to store after a newly selected pair is assigned to the UI.
 */
export function picksSinceAnchorPairAfterSelect(pair, streakUsedForPick) {
  if (!pair) return streakUsedForPick;
  return isAnchorPair(pair) ? 0 : streakUsedForPick + 1;
}
