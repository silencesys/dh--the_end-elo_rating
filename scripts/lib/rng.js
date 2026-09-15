'use strict';

/**
 * Seeded, deterministic RNG primitives.
 *
 * Decision D5 ("seed everything"): every bit of sampling/shuffling in the
 * dataset-connection toolkit must be reproducible from a single integer seed,
 * so we never reach for `Math.random`. `mulberry32` is a tiny, well-distributed
 * 32-bit generator — same seed in, same stream out, on any machine.
 */

/**
 * Create a deterministic PRNG seeded by `seed`.
 * @param {number} seed - any integer; coerced to uint32.
 * @returns {() => number} function returning floats in [0, 1).
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher–Yates shuffle driven by a seeded RNG. Non-mutating: returns a new array.
 * @template T
 * @param {T[]} arr
 * @param {() => number} rng - e.g. the result of `mulberry32(seed)`.
 * @returns {T[]} a shuffled copy of `arr`.
 */
function seededShuffle(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * Draw `n` elements from `arr` with replacement using a seeded RNG.
 * Used for bootstrap resampling of comparison pairs.
 * @template T
 * @param {T[]} arr
 * @param {number} n
 * @param {() => number} rng
 * @returns {T[]} array of length `n`.
 */
function sampleWithReplacement(arr, n, rng) {
  const out = new Array(n);
  const len = arr.length;
  for (let i = 0; i < n; i++) {
    out[i] = arr[Math.floor(rng() * len)];
  }
  return out;
}

module.exports = { mulberry32, seededShuffle, sampleWithReplacement };
