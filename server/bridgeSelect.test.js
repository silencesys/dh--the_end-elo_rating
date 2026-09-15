'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  pairKeyOf,
  countRatedByPair,
  sessionSeenKeys,
  selectNextBridgePair,
  computeProgress,
} = require('./bridgeSelect');

// island a,b ; mainland m1,m2 ; core-first order 0,1,2
const PAIRS = [
  { aId: 'a', bId: 'm1', targetCount: 2, order: 0, islandId: 'a' },
  { aId: 'a', bId: 'm2', targetCount: 2, order: 1, islandId: 'a' },
  { aId: 'b', bId: 'm1', targetCount: 2, order: 2, islandId: 'b' },
];

test('pairKeyOf is order-independent and coerces ids to strings', () => {
  assert.equal(pairKeyOf('a', 'm1'), pairKeyOf('m1', 'a'));
  assert.equal(pairKeyOf(1, 2), pairKeyOf(2, 1));
  assert.notEqual(pairKeyOf('a', 'm1'), pairKeyOf('a', 'm2'));
});

test('countRatedByPair: counts either order, skips skipped/missing, honors filter', () => {
  const sessions = [
    { comparisons: [{ winnerId: 'a', loserId: 'm1', skipped: false }] },
    { comparisons: [{ winnerId: 'm1', loserId: 'a', skipped: false }] }, // reversed -> same pair
    { comparisons: [{ winnerId: 'a', loserId: 'm1', skipped: true }] }, // skipped -> ignored
    { comparisons: [{ winnerId: 'a', loserId: null }] }, // missing -> ignored
    { comparisons: [{ winnerId: 'b', loserId: 'm1', skipped: false }] },
  ];
  const counts = countRatedByPair(sessions);
  assert.equal(counts.get(pairKeyOf('a', 'm1')), 2);
  assert.equal(counts.get(pairKeyOf('b', 'm1')), 1);

  const filtered = countRatedByPair(sessions, new Set([pairKeyOf('a', 'm1')]));
  assert.equal(filtered.get(pairKeyOf('a', 'm1')), 2);
  assert.equal(filtered.has(pairKeyOf('b', 'm1')), false);
});

test('sessionSeenKeys includes both rated and skipped pairs', () => {
  const seen = sessionSeenKeys({
    comparisons: [
      { winnerId: 'a', loserId: 'm1', skipped: false },
      { winnerId: 'b', loserId: 'm1', skipped: true },
    ],
  });
  assert.ok(seen.has(pairKeyOf('a', 'm1')));
  assert.ok(seen.has(pairKeyOf('b', 'm1')));
  assert.equal(sessionSeenKeys(null).size, 0);
});

test('selectNextBridgePair returns lowest-order pair with remaining quota', () => {
  const counts = new Map(); // nothing rated
  assert.equal(selectNextBridgePair(PAIRS, counts, new Set()).order, 0);
});

test('selectNextBridgePair skips fully-rated pairs', () => {
  const counts = new Map([[pairKeyOf('a', 'm1'), 2]]); // p0 done
  assert.equal(selectNextBridgePair(PAIRS, counts, new Set()).order, 1);
});

test('selectNextBridgePair skips pairs already seen this session', () => {
  const counts = new Map();
  const seen = new Set([pairKeyOf('a', 'm1'), pairKeyOf('a', 'm2')]);
  assert.equal(selectNextBridgePair(PAIRS, counts, seen).order, 2);
});

test('selectNextBridgePair returns null when every pair meets quota', () => {
  const counts = new Map([
    [pairKeyOf('a', 'm1'), 2],
    [pairKeyOf('a', 'm2'), 3], // over-rated still counts as done
    [pairKeyOf('b', 'm1'), 2],
  ]);
  assert.equal(selectNextBridgePair(PAIRS, counts, new Set()), null);
});

test('computeProgress: totalDone + remaining === totalTarget; counts connected islands', () => {
  const counts = new Map([[pairKeyOf('a', 'm1'), 2]]); // island a connected
  const p = computeProgress(PAIRS, counts);
  assert.equal(p.totalPairs, 3);
  assert.equal(p.totalTarget, 6);
  assert.equal(p.totalDone, 2);
  assert.equal(p.remaining, 4);
  assert.equal(p.totalDone + p.remaining, p.totalTarget);
  assert.equal(p.islandImagesConnected, 1);

  // connect island b too
  counts.set(pairKeyOf('b', 'm1'), 1);
  assert.equal(computeProgress(PAIRS, counts).islandImagesConnected, 2);
});

test('computeProgress caps done at targetCount (over-rating does not inflate)', () => {
  const counts = new Map([[pairKeyOf('a', 'm1'), 5]]); // target is 2
  const p = computeProgress(PAIRS, counts);
  assert.equal(p.totalDone, 2);
  assert.equal(p.remaining, 4);
});
