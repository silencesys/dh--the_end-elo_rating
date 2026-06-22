import test from 'node:test';
import assert from 'node:assert/strict';
import { isBridgeMode, fetchBridgePair } from './bridgeMode.js';

test('isBridgeMode detects ?source=bridge only', () => {
  assert.equal(isBridgeMode('?source=bridge'), true);
  assert.equal(isBridgeMode('?source=bridge&username=anna'), true);
  assert.equal(isBridgeMode('?source=normal'), false);
  assert.equal(isBridgeMode('?username=anna'), false);
  assert.equal(isBridgeMode(''), false);
});

async function withFetch(stub, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = orig;
  }
}

test('fetchBridgePair returns a live pair', async () => {
  await withFetch(
    async () => ({ json: async () => ({ pair: [{ _id: 'a' }, { _id: 'b' }], band: 'matched' }) }),
    async () => {
      const r = await fetchBridgePair('s1');
      assert.equal(r.done, false);
      assert.equal(r.pair.length, 2);
      assert.equal(r.band, 'matched');
    }
  );
});

test('fetchBridgePair maps done:true to a null pair', async () => {
  await withFetch(
    async () => ({ json: async () => ({ pair: null, done: true }) }),
    async () => {
      const r = await fetchBridgePair('s1');
      assert.equal(r.done, true);
      assert.equal(r.pair, null);
    }
  );
});

test('fetchBridgePair does not falsely complete on a network error', async () => {
  await withFetch(
    async () => { throw new Error('network down'); },
    async () => {
      const r = await fetchBridgePair('s1');
      assert.equal(r.done, false);
      assert.equal(r.pair, null);
    }
  );
});

test('fetchBridgePair encodes sessionId, omits it when absent', async () => {
  let url = null;
  await withFetch(
    async (u) => { url = u; return { json: async () => ({ pair: null, done: true }) }; },
    async () => {
      await fetchBridgePair('sess/1');
      assert.ok(url.includes('sessionId=sess%2F1'));
      await fetchBridgePair(null);
      assert.equal(url, '/api/bridge/next');
    }
  );
});
