'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { mulberry32 } = require('./rng');
const { recomputeEloSeeded, bootstrapOffset } = require('./offset');

// One connected graph where group A always beats group B, plus an internal edge
// on each side so every node is reachable (single component).
const GROUP_A = ['a1', 'a2'];
const GROUP_B = ['b1', 'b2'];
const PAIRS = [
  ['a1', 'b1'], ['a1', 'b2'],
  ['a2', 'b1'], ['a2', 'b2'],
  ['a1', 'a2'],
  ['b1', 'b2'],
];
const IDS = [...GROUP_A, ...GROUP_B];

test('recomputeEloSeeded ranks the dominant group above the other', () => {
  const ratings = recomputeEloSeeded(PAIRS, IDS, { K: 100, replays: 4, rng: mulberry32(1) });
  const meanA = (ratings.get('a1') + ratings.get('a2')) / 2;
  const meanB = (ratings.get('b1') + ratings.get('b2')) / 2;
  assert.ok(meanA > meanB, `expected A (${meanA}) > B (${meanB})`);
});

test('recomputeEloSeeded is reproducible under the same seed', () => {
  const r1 = recomputeEloSeeded(PAIRS, IDS, { K: 100, replays: 3, rng: mulberry32(123) });
  const r2 = recomputeEloSeeded(PAIRS, IDS, { K: 100, replays: 3, rng: mulberry32(123) });
  assert.deepEqual([...r1.entries()], [...r2.entries()]);
});

test('bootstrapOffset is fully reproducible for a fixed seed', () => {
  const common = { pairs: PAIRS, imageIds: IDS, groupA: GROUP_A, groupB: GROUP_B, K: 100, replays: 2, nBoot: 50 };
  const o1 = bootstrapOffset({ ...common, rng: mulberry32(42) });
  const o2 = bootstrapOffset({ ...common, rng: mulberry32(42) });
  assert.deepEqual(o1, o2);

  // A dominates B, so the point offset is clearly positive and the CI has width.
  assert.ok(o1.point > 0, `point offset ${o1.point} should be > 0`);
  assert.ok(o1.ciWidth >= 0);
  assert.equal(o1.nBoot, 50);
});

test('disconnected components: offset is ~0 (means pinned to 1500)', () => {
  // No cross edges -> each component keeps mean rating 1500 -> offset 0.
  const pairs = [['a1', 'a2'], ['b1', 'b2']];
  const o = bootstrapOffset({
    pairs, imageIds: IDS, groupA: GROUP_A, groupB: GROUP_B, rng: mulberry32(3), replays: 2, nBoot: 20,
  });
  assert.ok(Math.abs(o.point) < 1e-9, `offset ${o.point} should be ~0`);
});
