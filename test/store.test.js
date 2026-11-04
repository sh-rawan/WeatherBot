import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryStore } from '../src/store.js';
import { createFakeD1, createD1StoreForTest } from './fake-d1.js';

const TOKYO = { lat: 35.68, lon: 139.76, timezone: 'Asia/Tokyo' };
const DELHI = { lat: 28.61, lon: 77.21, timezone: 'Asia/Kolkata' };

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
}

test('D1 store: data survives between store instances', async () => {
  const db = createFakeD1();
  await createD1StoreForTest(db).setLocation('a', TOKYO);
  assert.deepEqual(await createD1StoreForTest(db).getLocation('a'), TOKYO);
});
