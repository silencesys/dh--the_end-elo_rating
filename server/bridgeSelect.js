'use strict';

/**
 * Pure bridge-serving logic (no DB, no Express) so it is trivially unit-testable.
 *
 * A "bridge pair" is an unordered island×mainland image pair from the M2 manifest.
 * It is satisfied once it has been rated `targetCount` times (across all annotators)
 * via the normal POST /api/compare flow — bridge votes are ordinary non-skipped
 * comparisons, so quota is measured by counting those comparisons per pair.
 */

/** Canonical key for an unordered image pair (sorted by id string). */
function pairKeyOf(a, b) {
  const x = String(a);
  const y = String(b);
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

/**
 * Count non-skipped comparisons per unordered pair across sessions.
 * @param {Array<{comparisons?: Array}>} sessions
 * @param {Set<string>} [keyFilter] - if given, only count keys in this set (bounds the map).
 * @returns {Map<string, number>}
 */
function countRatedByPair(sessions, keyFilter) {
  const counts = new Map();
  for (const s of sessions) {
    for (const c of (s.comparisons || [])) {
      if (c.skipped || !c.winnerId || !c.loserId) continue;
      const key = pairKeyOf(c.winnerId, c.loserId);
      if (keyFilter && !keyFilter.has(key)) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

/** Pair keys a session has already encountered (rated OR skipped) — do not re-serve. */
function sessionSeenKeys(session) {
  const set = new Set();
  if (!session) return set;
  for (const c of (session.comparisons || [])) {
    if (!c.winnerId || !c.loserId) continue;
    set.add(pairKeyOf(c.winnerId, c.loserId));
  }
  return set;
}

/**
 * Highest-priority bridge pair (lowest `order`, i.e. core-first) that still has
 * remaining quota and the session has not already seen.
 * @param {Array<{aId,bId,targetCount,order}>} bridgePairs - sorted by `order` asc.
 * @param {Map<string,number>} ratedCounts
 * @param {Set<string>} seenKeys
 * @returns {object|null}
 */
function selectNextBridgePair(bridgePairs, ratedCounts, seenKeys) {
  for (const bp of bridgePairs) {
    const key = pairKeyOf(bp.aId, bp.bId);
    if (seenKeys.has(key)) continue;
    const done = ratedCounts.get(key) || 0;
    if (bp.targetCount - done > 0) return bp;
  }
  return null;
}

/**
 * Aggregate progress for monitoring. `totalDone + remaining === totalTarget`.
 * `islandImagesConnected` counts distinct island images with >= 1 rated crossing.
 * @param {Array<{aId,bId,targetCount,islandId?}>} bridgePairs
 * @param {Map<string,number>} ratedCounts
 */
function computeProgress(bridgePairs, ratedCounts) {
  let totalTarget = 0;
  let totalDone = 0;
  let remaining = 0;
  const islandsConnected = new Set();
  for (const bp of bridgePairs) {
    const rated = ratedCounts.get(pairKeyOf(bp.aId, bp.bId)) || 0;
    totalTarget += bp.targetCount;
    totalDone += Math.min(rated, bp.targetCount);
    remaining += Math.max(0, bp.targetCount - rated);
    if (rated > 0 && bp.islandId != null) islandsConnected.add(String(bp.islandId));
  }
  return {
    totalPairs: bridgePairs.length,
    totalTarget,
    totalDone,
    remaining,
    islandImagesConnected: islandsConnected.size,
  };
}

module.exports = {
  pairKeyOf,
  countRatedByPair,
  sessionSeenKeys,
  selectNextBridgePair,
  computeProgress,
};
