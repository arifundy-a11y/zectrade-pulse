import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SEED_FEED } from '../data/defaults';
import { appendDeterministicLiveFeedItem } from './liveFeed';

describe('Landing Live Feed deterministic rotation', () => {
  it('never introduces duplicate item IDs even when called repeatedly in the same 4.5s slot', () => {
    const baseMs = 398951801 * 4500 + 100;
    const first = appendDeterministicLiveFeedItem(SEED_FEED, baseMs);
    assert.equal(first.length, 4);
    assert.equal(first[0].id, 'feed-398951801');

    // Second call within the exact same 4.5s slot returns the exact same array reference with zero duplicate keys
    const sameSlot = appendDeterministicLiveFeedItem(first, baseMs + 2500);
    assert.equal(sameSlot, first);
    assert.equal(new Set(sameSlot.map((i) => i.id)).size, sameSlot.length);

    // Next 4.5s slot prepends a new unique item
    const nextSlot = appendDeterministicLiveFeedItem(sameSlot, baseMs + 4500);
    assert.equal(nextSlot.length, 4);
    assert.equal(nextSlot[0].id, 'feed-398951802');
    assert.equal(new Set(nextSlot.map((i) => i.id)).size, nextSlot.length);
  });

  it('cleans up any pre-existing duplicate keys if passed in prev', () => {
    const duplicateInput = [
      { ...SEED_FEED[0], id: 'dup-1' },
      { ...SEED_FEED[1], id: 'dup-1' },
      { ...SEED_FEED[2], id: 'f3' },
    ];
    const result = appendDeterministicLiveFeedItem(duplicateInput, 1_795_283_824_000);
    assert.equal(new Set(result.map((i) => i.id)).size, result.length);
  });
});
