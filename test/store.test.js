import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { createStore } from '../src/store.js';

const TOKYO = { lat: 35.68, lon: 139.76, timezone: 'Asia/Tokyo' };
const OSAKA = { lat: 34.69, lon: 135.5, timezone: 'Asia/Tokyo' };

let dir;
let path;

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), 'weatherbot-store-'));
  path = join(dir, 'nested', 'users.json');
});

afterEach(() => {
  mock.restoreAll();
  fs.rmSync(dir, { recursive: true });
});

const fileError = (code) => Object.assign(new Error(code), { code });

test('users, updates and deletions survive a reload', () => {
  const store = createStore(path);
  store.setLocation('a', TOKYO);
  store.setLocation('b', OSAKA);
  store.updateUser('a', { lastCheckedDate: '2026-11-04' });
  store.deleteUser('b');

  const reloaded = createStore(path);
  assert.deepEqual(reloaded.getLocation('a'), { ...TOKYO, lastCheckedDate: '2026-11-04' });
  assert.equal(reloaded.getLocation('b'), undefined);
});

test('no temporary file is left behind after a save', () => {
  createStore(path).setLocation('a', TOKYO);
  assert.deepEqual(fs.readdirSync(join(dir, 'nested')), ['users.json']);
});

test('a crash while writing the temporary file leaves the saved data intact', () => {
  const store = createStore(path);
  store.setLocation('a', TOKYO);

  // A half-written temporary file is what a crash mid-save leaves behind.
  const realWrite = fs.writeFileSync;
  mock.method(fs, 'writeFileSync', (tempPath) => {
    realWrite(tempPath, '{"a": {"lat": 35.');
    throw new Error('crash');
  });
  assert.throws(() => store.setLocation('a', OSAKA), /crash/);
  mock.restoreAll();

  assert.deepEqual(createStore(path).getLocation('a'), TOKYO);
});

test('a leftover temporary file from a crash does not block later saves', () => {
  const store = createStore(path);
  store.setLocation('a', TOKYO);
  fs.writeFileSync(`${path}.tmp`, '{"half": ');

  const restarted = createStore(path);
  assert.deepEqual(restarted.getLocation('a'), TOKYO);
  restarted.setLocation('a', OSAKA);
  assert.deepEqual(createStore(path).getLocation('a'), OSAKA);
});

for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
  test(`a file briefly locked with ${code} is retried until the save succeeds`, () => {
    const store = createStore(path);
    const realRename = fs.renameSync;
    let attempts = 0;
    mock.method(fs, 'renameSync', (from, to) => {
      if (++attempts < 3) throw fileError(code);
      realRename(from, to);
    });
    store.setLocation('a', TOKYO);
    assert.equal(attempts, 3);
    mock.restoreAll();
    assert.deepEqual(createStore(path).getLocation('a'), TOKYO);
  });
}

test('a file that stays locked fails the save after 5 tries, keeping the old data', () => {
  const store = createStore(path);
  store.setLocation('a', TOKYO);
  let attempts = 0;
  mock.method(fs, 'renameSync', () => {
    attempts++;
    throw fileError('EPERM');
  });
  assert.throws(() => store.setLocation('a', OSAKA), /EPERM/);
  assert.equal(attempts, 5);
  mock.restoreAll();
  assert.deepEqual(createStore(path).getLocation('a'), TOKYO);
});

test('other errors are not retried', () => {
  const store = createStore(path);
  let attempts = 0;
  mock.method(fs, 'renameSync', () => {
    attempts++;
    throw fileError('ENOSPC');
  });
  assert.throws(() => store.setLocation('a', TOKYO), /ENOSPC/);
  assert.equal(attempts, 1);
});

test('without a path nothing is written', () => {
  const write = mock.method(fs, 'writeFileSync');
  createStore().setLocation('a', TOKYO);
  assert.equal(write.mock.callCount(), 0);
});
