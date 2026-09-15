'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { mulberry32, seededShuffle, sampleWithReplacement } = require('./rng');

test('mulberry32 is deterministic for a given seed', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = [a(), a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b(), b()];
  assert.deepEqual(seqA, seqB);
});

test('mulberry32 matches a known snapshot (guards against algorithm drift)', () => {
  const r = mulberry32(42);
  assert.deepEqual(
    [r(), r(), r()],
    [0.6011037519201636, 0.44829055899754167, 0.8524657934904099],
  );
});

test('mulberry32 outputs lie in [0, 1) and are not constant', () => {
  const r = mulberry32(7);
  const vals = Array.from({ length: 50 }, () => r());
  for (const v of vals) {
    assert.ok(v >= 0 && v < 1, `value ${v} out of range`);
  }
  assert.ok(new Set(vals).size > 1, 'stream should not be constant');
});

test('different seeds produce different streams', () => {
  const a = mulberry32(1);
  const b = mulberry32(2);
  assert.notDeepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('seededShuffle is a deterministic permutation that does not mutate input', () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8];
  const frozen = input.slice();

  const out1 = seededShuffle(input, mulberry32(99));
  const out2 = seededShuffle(input, mulberry32(99));

  assert.deepEqual(input, frozen, 'input must not be mutated');
  assert.deepEqual(out1, out2, 'same seed -> same order');
  assert.deepEqual(out1.slice().sort((x, y) => x - y), frozen, 'must be a permutation');
});

test('sampleWithReplacement is deterministic and correctly sized', () => {
  const pool = ['a', 'b', 'c', 'd'];
  const s1 = sampleWithReplacement(pool, 10, mulberry32(5));
  const s2 = sampleWithReplacement(pool, 10, mulberry32(5));
  assert.equal(s1.length, 10);
  assert.deepEqual(s1, s2);
  for (const x of s1) assert.ok(pool.includes(x));
});
