import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryStore } from '../src/store.js';
import { createFakeD1, createD1StoreForTest } from './fake-d1.js';

const TOKYO = { lat: 35.68, lon: 139.76, timezone: 'Asia/Tokyo' };
const DELHI = { lat: 28.61, lon: 77.21, timezone: 'Asia/Kolkata' };
const SUGGESTION = {
  userId: 'a',
  messageId: 7,
  source: 'evening',
  sentAt: '2026-11-04T11:00:00.000Z',
  forecastDate: '2026-11-05',
  timezone: 'Asia/Tokyo',
  icons: '☔-🚫-🚫-🚫',
  reasons: ['umbrella'],
  snapshot: { parts: [{ name: 'Morning', rainMm: 3 }], changeC: -4.2 },
};

// Both stores must behave the same, because the tests and simulator use the memory one.
for (const [name, createStore] of [
  ['D1', () => createD1StoreForTest(createFakeD1())],
  ['memory', createMemoryStore],
]) {
  test(`${name} store: saves, returns and lists users`, async () => {
    const store = createStore();
    assert.equal(await store.getLocation('a'), undefined);
    await store.setLocation('a', TOKYO);
    await store.setLocation('b', DELHI);
    assert.deepEqual(await store.getLocation('a'), TOKYO);
    const users = await store.getUsers();
    assert.deepEqual(users.sort(), [
      ['a', TOKYO],
      ['b', DELHI],
    ]);
  });

  test(`${name} store: marks a user as checked`, async () => {
    const store = createStore();
    await store.setLocation('a', TOKYO);
    await store.markChecked('a', '2026-11-04');
    assert.deepEqual(await store.getLocation('a'), { ...TOKYO, lastCheckedDate: '2026-11-04' });
  });

  test(`${name} store: a new location replaces the old one and clears the checked date`, async () => {
    const store = createStore();
    await store.setLocation('a', TOKYO);
    await store.markChecked('a', '2026-11-04');
    await store.setLocation('a', DELHI);
    assert.deepEqual(await store.getLocation('a'), DELHI);
    assert.equal((await store.getUsers()).length, 1);
  });

  test(`${name} store: deletes a user and ignores unknown ones`, async () => {
    const store = createStore();
    await store.setLocation('a', TOKYO);
    await store.deleteUser('a');
    await store.deleteUser('nobody');
    await store.markChecked('nobody', '2026-11-04');
    assert.equal(await store.getLocation('a'), undefined);
    assert.deepEqual(await store.getUsers(), []);
  });

  test(`${name} store: a card with no reaction is logged as none`, async () => {
    const store = createStore();
    await store.logSuggestion(SUGGESTION);
    assert.deepEqual(await store.getSuggestions('a'), [{ ...SUGGESTION, reaction: 'none' }]);
  });

  test(`${name} store: a reaction updates its card, and the latest tap wins`, async () => {
    const store = createStore();
    await store.logSuggestion(SUGGESTION);
    await store.logSuggestion({ ...SUGGESTION, messageId: 8 });
    await store.recordReaction('a', 7, 'like', '2026-11-04T12:00:00.000Z');
    await store.recordReaction('a', 7, 'dislike', '2026-11-04T12:05:00.000Z');
    const [first, second] = await store.getSuggestions('a');
    assert.equal(first.reaction, 'dislike');
    assert.equal(first.reactedAt, '2026-11-04T12:05:00.000Z');
    assert.equal(second.reaction, 'none');
    assert.equal(second.reactedAt, undefined);
  });

  test(`${name} store: a reaction only affects that user's card`, async () => {
    const store = createStore();
    await store.logSuggestion(SUGGESTION);
    await store.logSuggestion({ ...SUGGESTION, userId: 'b' });
    await store.recordReaction('b', 7, 'like', '2026-11-04T12:00:00.000Z');
    assert.equal((await store.getSuggestions('a'))[0].reaction, 'none');
    assert.equal((await store.getSuggestions('b'))[0].reaction, 'like');
  });

  test(`${name} store: a reaction with no matching card changes nothing`, async () => {
    const store = createStore();
    await store.recordReaction('a', 99, 'like', '2026-11-04T12:00:00.000Z');
    assert.deepEqual(await store.getSuggestions('a'), []);
  });

  test(`${name} store: logging and marking checked happen together`, async () => {
    const store = createStore();
    await store.setLocation('a', TOKYO);
    await store.logSuggestionAndMarkChecked(SUGGESTION, 'a', '2026-11-04');
    assert.equal((await store.getLocation('a')).lastCheckedDate, '2026-11-04');
    assert.equal((await store.getSuggestions('a')).length, 1);
  });
}

test('D1 store: data survives between store instances', async () => {
  const db = createFakeD1();
  await createD1StoreForTest(db).setLocation('a', TOKYO);
  assert.deepEqual(await createD1StoreForTest(db).getLocation('a'), TOKYO);
});
