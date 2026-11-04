import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createTelegramClient } from '../src/telegram.js';

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

test('setWebhook sends the URL, secret and the update types the bot uses', async () => {
  const requests = stubFetch({ ok: true, result: true });
  await createTelegramClient({ token: 'T' }).setWebhook('https://example.com/hook', 'S');
  assert.equal(requests[0].url, 'https://api.telegram.org/botT/setWebhook');
  assert.deepEqual(requests[0].body, {
    url: 'https://example.com/hook',
    secret_token: 'S',
    allowed_updates: ['message', 'my_chat_member', 'callback_query'],
  });
});

test('Telegram errors are thrown without revealing the token', async () => {
  stubFetch({ ok: false, error_code: 401, description: 'Unauthorized' });
  await assert.rejects(
    createTelegramClient({ token: 'SECRET' }).getMe(),
    (err) => err.message === 'Telegram getMe failed: Unauthorized (401)',
  );
});

test('answerButton stops the spinner with a note', async () => {
  const requests = stubFetch({ ok: true, result: true });
  await createTelegramClient({ token: 'T' }).answerButton('abc', 'Thanks');
  assert.equal(requests[0].url, 'https://api.telegram.org/botT/answerCallbackQuery');
  assert.deepEqual(requests[0].body, { callback_query_id: 'abc', text: 'Thanks' });
});

test('setMessageKeyboard updates the buttons on a message', async () => {
  const requests = stubFetch({ ok: true, result: {} });
  const keyboard = { inline_keyboard: [] };
  await createTelegramClient({ token: 'T' }).setMessageKeyboard('111', 5, keyboard);
  assert.equal(requests[0].url, 'https://api.telegram.org/botT/editMessageReplyMarkup');
  assert.deepEqual(requests[0].body, { chat_id: '111', message_id: 5, reply_markup: keyboard });
});

test('tapping the same button twice is not an error', async () => {
  stubFetch({ ok: false, error_code: 400, description: 'Bad Request: message is not modified' });
  await createTelegramClient({ token: 'T' }).setMessageKeyboard('111', 5, {});
});

test('other button update errors are still reported', async () => {
  stubFetch({ ok: false, error_code: 400, description: 'Bad Request: message to edit not found' });
  await assert.rejects(createTelegramClient({ token: 'T' }).setMessageKeyboard('111', 5, {}), /not found/);
});
