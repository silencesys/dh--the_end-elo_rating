export function getPairKey(id1, id2) {
  return [String(id1), String(id2)].sort().join('|');
}

/**
 * Classify images as "new" (underrepresented) vs "established".
 *
 * "New" = comparisons count is at or below the 25th percentile of the full
 * collection.  When the spread across all images is ≤ 5 comparisons (e.g. a
 * fresh database where everyone is roughly even), every image is treated as
 * new so behaviour degrades gracefully to the unweighted case.
 */
function classifyImages(images) {
  const sorted = [...images].sort((a, b) => a.comparisons - b.comparisons);
  const minC   = sorted[0].comparisons;
  const maxC   = sorted[sorted.length - 1].comparisons;

  if (maxC - minC <= 5) {
    const newSet = new Set(images.map((img) => String(img._id)));
    return newSet;
  }

  const q1C    = sorted[Math.floor(sorted.length * 0.25)].comparisons;
  const newSet = new Set(
    sorted.filter((img) => img.comparisons <= q1C).map((img) => String(img._id))
  );
  return newSet;
}

/**
 * Pick the next image pair to show.
 *
 * Strategy:
 *   Images are split into "new" (bottom-25th-percentile by comparisons) and
 *   "established".  Candidate pairs are ordered into four tiers:
 *
 *   Tier 1 — contains ≥1 new image AND avoids images from the last trial
 *   Tier 2 — contains ≥1 new image (may reuse a last-shown image)
 *   Tier 3 — established × established, avoids last trial  ← occasional
 *   Tier 4 — established × established (last resort)
 *
 *   With probability ESTABLISHED_CHANCE the algorithm skips to tier 3/4 so
 *   that well-ranked images keep receiving comparisons for re-calibration.
 *   Otherwise tier 1 → tier 2 → tier 3 → tier 4 in order.
 *
 *   Within the chosen tier, prefer the pair(s) with the lowest combined
 *   comparisons count (within a tolerance of 2), then pick randomly.
 *   Left/right position is randomised.
 */
const ESTABLISHED_CHANCE = 0.15; // ~1-in-7 comparisons uses an established pair

export function pickNextPair(images, ratedPairIds, lastShownIds) {
  if (images.length < 2) return null;

  const newSet = classifyImages(images);
  const isNew  = (img) => newSet.has(String(img._id));

  const t1 = []; // ≥1 new, avoids last shown  ← primary
  const t2 = []; // ≥1 new, may repeat last    ← secondary
  const t3 = []; // established×established, avoids last shown
  const t4 = []; // established×established, may repeat last

  for (let i = 0; i < images.length; i++) {
    for (let j = i + 1; j < images.length; j++) {
      const a = images[i];
      const b = images[j];
      if (ratedPairIds.has(getPairKey(a._id, b._id))) continue;

      const hasNew     = isNew(a) || isNew(b);
      const avoidsLast =
        !lastShownIds.includes(String(a._id)) &&
        !lastShownIds.includes(String(b._id));

      if      (hasNew  && avoidsLast) t1.push([a, b]);
      else if (hasNew)                t2.push([a, b]);
      else if (avoidsLast)            t3.push([a, b]);
      else                            t4.push([a, b]);
    }
  }

  const hasEstablished = t3.length > 0 || t4.length > 0;
  let pool;
  if (hasEstablished && Math.random() < ESTABLISHED_CHANCE) {
    pool = t3.length > 0 ? t3 : t4;
  } else if (t1.length > 0) pool = t1;
  else if (t2.length > 0)   pool = t2;
  else if (t3.length > 0)   pool = t3;
  else if (t4.length > 0)   pool = t4;
  else return null;

  pool.sort(
    (pa, pb) =>
      pa[0].comparisons + pa[1].comparisons -
      (pb[0].comparisons + pb[1].comparisons)
  );
  const minComps   = pool[0][0].comparisons + pool[0][1].comparisons;
  const lowestTier = pool.filter(
    ([a, b]) => a.comparisons + b.comparisons <= minComps + 2
  );

  const pair = lowestTier[Math.floor(Math.random() * lowestTier.length)];
  return Math.random() < 0.5 ? pair : [pair[1], pair[0]];
}
