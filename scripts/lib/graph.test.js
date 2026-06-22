'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  pairKey,
  splitKey,
  buildGraph,
  subgraph,
  connectedComponents,
  degreeStats,
  coverage,
  crossComponentEdges,
  leafNodes,
  percentile,
  gini,
} = require('./graph');

// A tiny, hand-checked graph:
//   Component 1: a,b,c,d   edges: a-b ×3, b-c ×2, c-a ×2, c-d ×1
//   Component 2: e,f       edge:  e-f ×1
// Degrees (comparisons/image): a=5 b=5 c=5 d=1 e=1 f=1
const PAIRS = [
  ['a', 'b'], ['a', 'b'], ['a', 'b'],
  ['b', 'c'], ['b', 'c'],
  ['c', 'a'], ['c', 'a'],
  ['c', 'd'],
  ['e', 'f'],
];

test('pairKey is order-independent and reversible', () => {
  assert.equal(pairKey('a', 'b'), pairKey('b', 'a'));
  assert.notEqual(pairKey('a', 'b'), pairKey('a', 'c'));
  assert.deepEqual(splitKey(pairKey('x', 'y')).sort(), ['x', 'y']);
});

test('buildGraph: nodes, adjacency, degree, pairCount', () => {
  const g = buildGraph(PAIRS);

  assert.equal(g.nodes.size, 6);

  // distinct neighbours (adj) collapse repeats
  assert.deepEqual([...g.adj.get('a')].sort(), ['b', 'c']);
  assert.deepEqual([...g.adj.get('c')].sort(), ['a', 'b', 'd']);
  assert.deepEqual([...g.adj.get('d')], ['c']);

  // degree counts every comparison (repeats included)
  assert.equal(g.degree.get('a'), 5);
  assert.equal(g.degree.get('b'), 5);
  assert.equal(g.degree.get('c'), 5);
  assert.equal(g.degree.get('d'), 1);
  assert.equal(g.degree.get('e'), 1);
  assert.equal(g.degree.get('f'), 1);

  // pairCount preserves multiplicity
  assert.equal(g.pairCount.size, 5);
  assert.equal(g.pairCount.get(pairKey('a', 'b')), 3);
  assert.equal(g.pairCount.get(pairKey('b', 'c')), 2);
  assert.equal(g.pairCount.get(pairKey('c', 'd')), 1);
});

test('buildGraph ignores self-comparisons', () => {
  const g = buildGraph([['x', 'x'], ['x', 'y']]);
  assert.equal(g.nodes.size, 2);
  assert.equal(g.degree.get('x'), 1);
  assert.equal(g.pairCount.size, 1);
});

test('connectedComponents: two components, largest first', () => {
  const comps = connectedComponents(buildGraph(PAIRS));
  assert.equal(comps.length, 2);
  assert.deepEqual(comps.map((c) => c.length), [4, 2]);
  assert.deepEqual([...comps[0]].sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual([...comps[1]].sort(), ['e', 'f']);
});

test('connectedComponents: single connected graph', () => {
  const comps = connectedComponents(buildGraph([['a', 'b'], ['b', 'c'], ['c', 'd']]));
  assert.equal(comps.length, 1);
  assert.equal(comps[0].length, 4);
});

test('degreeStats over the whole graph', () => {
  const s = degreeStats(buildGraph(PAIRS)); // degrees [5,5,5,1,1,1]
  assert.equal(s.count, 6);
  assert.equal(s.mean, 3);
  assert.equal(s.median, 3);
  assert.equal(s.min, 1);
  assert.equal(s.max, 5);
  assert.equal(s.p10, 1);
  assert.equal(s.p25, 1);
  assert.equal(s.p75, 5);
  assert.equal(s.p90, 5);
  assert.ok(Math.abs(s.gini - 1 / 3) < 1e-9, `gini ${s.gini}`);
  assert.equal(s.coldCount, 3); // d,e,f have <5 comparisons
});

test('coverage over the whole graph', () => {
  const cov = coverage(buildGraph(PAIRS), 6);
  assert.equal(cov.uniquePairs, 5);
  assert.equal(cov.possible, 15);
  assert.ok(Math.abs(cov.pct - (5 / 15) * 100) < 1e-9);
  assert.equal(cov.repeats, 3); // (a,b),(b,c),(a,c) each compared >1
  assert.equal(cov.maxRepeat, 3);
});

test('subgraph induces the larger component and recomputes stats', () => {
  const g = buildGraph(PAIRS);
  const sub = subgraph(g, ['a', 'b', 'c', 'd']);
  assert.equal(sub.nodes.size, 4);
  assert.equal(sub.pairCount.size, 4); // e-f dropped
  assert.equal(sub.degree.get('a'), 5);

  const s = degreeStats(sub);
  assert.equal(s.coldCount, 1); // only d
  const cov = coverage(sub, 4);
  assert.equal(cov.uniquePairs, 4);
  assert.equal(cov.possible, 6);
});

test('crossComponentEdges: zero for real components, found for an arbitrary cut', () => {
  const g = buildGraph(PAIRS);
  const comps = connectedComponents(g);
  assert.equal(crossComponentEdges(g, comps).length, 0);

  // Cut node b away from the rest of its component: edges a-b and b-c now cross.
  const cut = crossComponentEdges(g, [['a', 'c', 'd', 'e', 'f'], ['b']]);
  assert.equal(cut.length, 2);
  const counts = cut.map((e) => e.count).sort((x, y) => x - y);
  assert.deepEqual(counts, [2, 3]); // b-c ×2, a-b ×3
});

test('leafNodes: images with exactly one opponent', () => {
  const leaves = leafNodes(buildGraph(PAIRS)).sort();
  assert.deepEqual(leaves, ['d', 'e', 'f']);
});

test('percentile and gini edge cases', () => {
  assert.equal(percentile([], 50), 0);
  assert.equal(percentile([7], 99), 7);
  assert.equal(percentile([1, 2, 3, 4], 50), 2.5);
  assert.equal(gini([5, 5, 5]), 0); // perfectly equal
  assert.equal(gini([]), 0);
});

test('empty graph degreeStats is all-zero', () => {
  const s = degreeStats(buildGraph([]));
  assert.equal(s.count, 0);
  assert.equal(s.mean, 0);
  assert.equal(s.coldCount, 0);
});
