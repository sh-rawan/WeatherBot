import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createTelegramClient, pollOnce } from '../src/telegram.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(response) {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return { json: async () => response };
  };
  return requests;
}

test('sendText sends the chat, text, formatting and keyboard', async () => {
  const requests = stubFetch({ ok: true, result: {} });
  const keyboard = { keyboard: [[{ text: 'Today' }]] };
  await createTelegramClient({ token: 'T' }).sendText('111', '*Hi*', keyboard);
  assert.equal(requests[0].url, 'https://api.telegram.org/botT/sendMessage');
  assert.deepEqual(requests[0].body, {
    chat_id: '111',
    text: '*Hi*',
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
});

test('getUpdates long-polls for only the update types the bot uses', async () => {
  const requests = stubFetch({ ok: true, result: [] });
  await createTelegramClient({ token: 'T' }).getUpdates(7);
  assert.deepEqual(requests[0].body, {
    offset: 7,
    timeout: 30,
    allowed_updates: ['message', 'my_chat_member'],
  });
});

test('Telegram errors are thrown without revealing the token', async () => {
  stubFetch({ ok: false, error_code: 401, description: 'Unauthorized' });
  await assert.rejects(
    createTelegramClient({ token: 'SECRET' }).getMe(),
    (err) => err.message === 'Telegram getMe failed: Unauthorized (401)',
  );
});

test('pollOnce handles updates in order and returns the next offset', async () => {
  const handled = [];
  const client = { getUpdates: async () => [{ update_id: 5 }, { update_id: 6 }] };
  const next = await pollOnce({ client, offset: 5, onUpdate: async (u) => handled.push(u.update_id) });
  assert.deepEqual(handled, [5, 6]);
  assert.equal(next, 7);
});

test('pollOnce keeps the offset when there are no updates', async () => {
  const client = { getUpdates: async () => [] };
  assert.equal(await pollOnce({ client, offset: 9, onUpdate: async () => {} }), 9);
});

test('one failing update does not block the rest or get retried forever', async () => {
  const handled = [];
  const client = { getUpdates: async () => [{ update_id: 1 }, { update_id: 2 }] };
  const next = await pollOnce({
    client,
    onUpdate: async (u) => {
      if (u.update_id === 1) throw new Error('boom');
      handled.push(u.update_id);
    },
    log: { error() {} },
  });
  assert.deepEqual(handled, [2]);
  assert.equal(next, 3);
});
