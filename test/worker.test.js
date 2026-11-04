import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import worker from '../src/worker.js';
import { createD1Store } from '../src/store.js';
import { WEBHOOK_PATH } from '../src/telegram.js';
import { createFakeD1 } from './fake-d1.js';

const SECRET = 'test-secret';

// Reads the weather tiles of a card, as morning-afternoon-evening-night.
const iconsIn = (keyboard) => keyboard.inline_keyboard[1].map((tile) => tile.text).join('-');
const realFetch = globalThis.fetch;
const realDate = Date.now;

let env;
let sent;
let calls;
let telegramFails;
let forecastFails;

// Past 7 days, today and 2 more days, with tomorrow morning needing an umbrella.
function forecastResponse() {
  const size = 240;
  const precipitation = Array(size).fill(0);
  precipitation[8 * 24 + 9] = 3;
  return {
    timezone: 'Asia/Tokyo',
    hourly: {
      time: Array.from({ length: size }, (_, i) => new Date(Date.UTC(2026, 9, 28, i)).toISOString().slice(0, 16)),
      temperature_2m: Array(size).fill(25),
      precipitation,
      precipitation_probability: Array(size).fill(0),
      weather_code: Array(size).fill(3),
      wind_gusts_10m: Array(size).fill(5),
    },
  };
}

beforeEach(() => {
  env = { DB: createFakeD1(), TELEGRAM_BOT_TOKEN: 'T', WEBHOOK_SECRET: SECRET, ADMIN_USER_ID: '111' };
  sent = [];
  calls = [];
  telegramFails = false;
  forecastFails = false;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('open-meteo')) {
      if (forecastFails) return new Response('error', { status: 502 });
      return Response.json(forecastResponse());
    }
    if (telegramFails) return Response.json({ ok: false, error_code: 500, description: 'down' });
    const method = String(url).split('/').pop();
    calls.push(method);
    if (method === 'sendMessage') sent.push(JSON.parse(options.body));
    return Response.json({ ok: true, result: { message_id: sent.length } });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realDate;
});

const post = (body, { path = WEBHOOK_PATH, secret = SECRET } = {}) =>
  worker.fetch(
    new Request(`https://bot.test${path}`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {},
    }),
    env,
  );

const message = (fields) => ({ update_id: 1, message: { chat: { id: 111, type: 'private' }, ...fields } });
const LOCATION = { location: { latitude: 35.68, longitude: 139.76 } };

async function runSchedule() {
  const waiting = [];
  await worker.scheduled({}, env, { waitUntil: (promise) => waiting.push(promise) });
  await Promise.all(waiting);
}

test('the Worker only exports its handlers, which Cloudflare requires', async () => {
  const exported = await import('../src/worker.js');
  assert.deepEqual(Object.keys(exported), ['default']);
  assert.deepEqual(Object.keys(exported.default).sort(), ['fetch', 'scheduled']);
});

test('sharing a location through the webhook saves it in the database and replies', async () => {
  const res = await post(message(LOCATION));
  assert.equal(res.status, 200);
  assert.equal(sent[0].chat_id, '111');
  assert.match(sent[0].text, /Location saved/);
  assert.deepEqual(await createD1Store(env.DB).getLocation('111'), {
    lat: 35.68,
    lon: 139.76,
    timezone: 'Asia/Tokyo',
  });
});

test('Tomorrow replies with a day card, using the saved location', async () => {
  await post(message(LOCATION));
  await post(message({ text: 'Tomorrow' }));
  assert.equal(iconsIn(sent[1].reply_markup), '☔-🚫-🚫-🚫');
  assert.equal(sent[1].text, '☔ · 🚫 · 🚫 · 🚫');
});

test('a button tap through the webhook updates the logged card in the database', async () => {
  await post(message(LOCATION));
  await post(message({ text: 'Tomorrow' }));
  const store = createD1Store(env.DB);
  assert.equal((await store.getSuggestions('111'))[0].reaction, 'none');

  const res = await post({
    update_id: 2,
    callback_query: { id: 'tap', data: 'dislike', message: { message_id: 2, chat: { id: 111, type: 'private' } } },
  });
  assert.equal(res.status, 200);
  assert.equal((await store.getSuggestions('111'))[0].reaction, 'dislike');
  assert.deepEqual(calls.slice(-2), ['answerCallbackQuery', 'editMessageReplyMarkup']);
});

test('the evening card is sent with buttons and logged in the database', async () => {
  const store = createD1Store(env.DB);
  await store.setLocation('111', { lat: 35.68, lon: 139.76, timezone: 'Asia/Tokyo' });
  Date.now = () => new Date('2026-11-04T11:30:00Z').getTime(); // 20:30 in Tokyo.
  await runSchedule();
  assert.deepEqual(sent[0].reply_markup.inline_keyboard[2].map((b) => b.text), ['👍', '👎']);
  const [logged] = await store.getSuggestions('111');
  assert.equal(logged.source, 'evening');
  assert.equal(logged.reaction, 'none');
  assert.deepEqual(logged.reasons, ['umbrella']);
  assert.equal(logged.messageId, 1);
});

test('the test message route sends a card to the admin only', async () => {
  const store = createD1Store(env.DB);
  await store.setLocation('111', { lat: 35.68, lon: 139.76, timezone: 'Asia/Tokyo' });
  await store.setLocation('222', { lat: 35.68, lon: 139.76, timezone: 'Asia/Tokyo' });
  const res = await post('', { path: '/admin/test-message' });
  assert.equal(res.status, 200);
  assert.deepEqual(sent.map((m) => m.chat_id), ['111']);
  assert.equal((await store.getSuggestions('111'))[0].source, 'test');
  assert.deepEqual(await store.getSuggestions('222'), []);
});

test('the test message route needs the secret', async () => {
  await createD1Store(env.DB).setLocation('111', { lat: 35.68, lon: 139.76, timezone: 'Asia/Tokyo' });
  assert.equal((await post('', { path: '/admin/test-message', secret: null })).status, 403);
  assert.equal((await post('', { path: '/admin/test-message', secret: 'wrong-secret' })).status, 403);
  assert.equal(sent.length, 0);
});

test('the test message route reports a failure when no admin is set', async () => {
  delete env.ADMIN_USER_ID;
  assert.equal((await post('', { path: '/admin/test-message' })).status, 500);
  assert.equal(sent.length, 0);
});

test('stopping notifications through the webhook stops the evening card', async () => {
  await post(message(LOCATION));
  await post(message({ text: '🔕 Stop notifications' }));
  const before = sent.length;
  Date.now = () => new Date('2026-11-04T11:30:00Z').getTime(); // 20:30 in Tokyo.
  await runSchedule();
  assert.equal(sent.length, before);
  assert.ok((await createD1Store(env.DB).getLocation('111')).notificationsOffAt);

  await post(message({ text: '🔔 Turn on notifications' }));
  await runSchedule();
  assert.equal(sent.length, before + 2);
});

test('a wrong or missing secret is rejected and does nothing', async () => {
  assert.equal((await post(message(LOCATION), { secret: 'wrong-secret' })).status, 403);
  assert.equal((await post(message(LOCATION), { secret: 'wrong' })).status, 403);
  assert.equal((await post(message(LOCATION), { secret: null })).status, 403);
  assert.equal(sent.length, 0);
  assert.equal(await createD1Store(env.DB).getLocation('111'), undefined);
});

test('a failed reply returns an error, so Telegram sends the update again', async () => {
  telegramFails = true;
  const res = await post(message({ text: 'help' }));
  assert.equal(res.status, 500);
  telegramFails = false;
  assert.equal((await post(message({ text: 'help' }))).status, 200);
  assert.equal(sent.length, 1);
});

test('a forecast outage tells the user, and does not make Telegram retry', async () => {
  forecastFails = true;
  const res = await post(message(LOCATION));
  assert.equal(res.status, 200);
  assert.match(sent[0].text, /couldn't get the forecast/);
});

test('invalid JSON gets 400', async () => {
  assert.equal((await post('not json')).status, 400);
});

test('other routes respond correctly', async () => {
  const health = await worker.fetch(new Request('https://bot.test/health'), env);
  assert.equal(health.status, 200);
  assert.equal((await worker.fetch(new Request('https://bot.test/nope'), env)).status, 404);
  assert.equal((await post({}, { path: '/nope' })).status, 404);
});

test('the schedule sends the evening message once, and saves the checked date', async () => {
  const store = createD1Store(env.DB);
  await store.setLocation('111', { lat: 35.68, lon: 139.76, timezone: 'Asia/Tokyo' });
  Date.now = () => new Date('2026-11-04T11:30:00Z').getTime(); // 20:30 in Tokyo.

  await runSchedule();
  await runSchedule();
  assert.deepEqual(sent.map((m) => iconsIn(m.reply_markup)), ['☔-🚫-🚫-🚫']);
  assert.equal(sent[0].chat_id, '111');
  assert.equal((await store.getLocation('111')).lastCheckedDate, '2026-11-04');
});

test('the schedule sends nothing before the evening', async () => {
  await createD1Store(env.DB).setLocation('111', { lat: 35.68, lon: 139.76, timezone: 'Asia/Tokyo' });
  Date.now = () => new Date('2026-11-04T10:30:00Z').getTime(); // 19:30 in Tokyo.
  await runSchedule();
  assert.equal(sent.length, 0);
});
