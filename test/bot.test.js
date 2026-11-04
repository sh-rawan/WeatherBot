import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createBot } from '../src/bot.js';
import { createStore } from '../src/store.js';

const CHAT_ID = 111;
const USER = String(CHAT_ID);
const TOKYO = { latitude: 35.68, longitude: 139.76 };
const SAVED_TOKYO = { lat: 35.68, lon: 139.76 };

const forecast = (timezone = 'Asia/Tokyo') => {
  const size = 72;
  return {
    timezone,
    hourly: {
      time: Array.from({ length: size }, (_, i) => `2026-11-0${4 + Math.floor(i / 24)}T00:00`),
      temperature_2m: Array(size).fill(12),
      precipitation: Array(size).fill(0),
      precipitation_probability: Array(size).fill(0),
      weather_code: Array(size).fill(1),
      wind_gusts_10m: Array(size).fill(5),
    },
  };
};

const privateChat = { id: CHAT_ID, type: 'private' };

function setup({ fetchForecast = async () => forecast(), store = createStore() } = {}) {
  const sent = [];
  const messenger = { sendText: async (to, text, keyboard) => sent.push({ to, text, keyboard }) };
  const bot = createBot({ messenger, store, fetchForecast, log: { error() {} } });
  const send = (fields) => bot.handleUpdate({ update_id: 1, message: { chat: privateChat, ...fields } });
  const say = (text) => send({ text });
  const share = (location = TOKYO) => send({ location });
  return { bot, sent, store, say, share, send };
}

const firstButton = (keyboard) => keyboard.keyboard[0][0];

test('/start asks for a location with a location button', async () => {
  const { sent, say } = setup();
  await say('/start');
  assert.equal(sent[0].to, USER);
  assert.match(sent[0].text, /^Hi!.*share your location/);
  assert.equal(firstButton(sent[0].keyboard).request_location, true);
});

test('/start from someone with a saved location shows the menu', async () => {
  const { sent, say, share } = setup();
  await share();
  await say('/start');
  assert.match(sent[1].text, /Choose Today or Tomorrow/);
});

test('asking for weather before sharing a location asks for it', async () => {
  const { sent, say } = setup();
  await say('today');
  assert.match(sent[0].text, /need your location/);
});

test('sharing a location saves it and replies with today, using those coordinates', async () => {
  const calls = [];
  const { sent, store, share } = setup({
    fetchForecast: async (lat, lon) => {
      calls.push([lat, lon]);
      return forecast();
    },
  });
  await share();
  assert.deepEqual(store.getLocation(USER), SAVED_TOKYO);
  assert.deepEqual(calls, [[35.68, 139.76]]);
  assert.match(sent[0].text, /Today, Wed 4 Nov/);
  assert.equal(firstButton(sent[0].keyboard).text, 'Today');
});

test('sharing a location explains the notifications and icons', async () => {
  const { sent, share } = setup();
  await share();
  assert.match(sent[0].text, /morning - afternoon - evening - night/);
});

test('a location outside Japan is declined and not saved', async () => {
  const { sent, store, share } = setup({ fetchForecast: async () => forecast('Asia/Seoul') });
  await share();
  assert.equal(store.getLocation(USER), undefined);
  assert.match(sent[0].text, /only cover Japan/);
  assert.equal(firstButton(sent[0].keyboard).request_location, true);
});

test('a location outside Japan keeps the previously saved one', async () => {
  let timezone = 'Asia/Tokyo';
  const { sent, store, share } = setup({ fetchForecast: async () => forecast(timezone) });
  await share();
  timezone = 'Asia/Taipei';
  await share({ latitude: 25.03, longitude: 121.57 });
  assert.deepEqual(store.getLocation(USER), SAVED_TOKYO);
  assert.match(sent[1].text, /only cover Japan/);
  assert.equal(firstButton(sent[1].keyboard).text, 'Today');
});

test('a location is not saved when the forecast check fails', async () => {
  const { sent, store, share } = setup({
    fetchForecast: async () => {
      throw new Error('down');
    },
  });
  await share();
  assert.equal(store.getLocation(USER), undefined);
  assert.match(sent[0].text, /couldn't get the forecast/);
});

test('the Today and Tomorrow buttons work, regardless of case', async () => {
  const { sent, say, share } = setup();
  await share();
  await say('Today');
  await say(' tomorrow ');
  assert.match(sent[1].text, /Today, Wed 4 Nov/);
  assert.match(sent[2].text, /Tomorrow, Thu 5 Nov/);
});

test('inherited object keys are not treated as commands', async () => {
  const { sent, say, share } = setup();
  await share();
  await say('constructor');
  assert.match(sent[1].text, /Choose Today or Tomorrow/);
});

test('a location button that arrives as text explains that a phone is needed', async () => {
  const { sent, say, share } = setup();
  await say('📍 Share my location');
  assert.match(sent[0].text, /mobile app/);
  assert.equal(firstButton(sent[0].keyboard).request_location, true);
  await share();
  await say('📍 Update location');
  assert.match(sent[2].text, /mobile app/);
  assert.equal(firstButton(sent[2].keyboard).text, 'Today');
});

test('messages without text, such as photos, get the menu rather than a crash', async () => {
  const { sent, send, share } = setup();
  await share();
  await send({ photo: [] });
  assert.match(sent[1].text, /Choose Today or Tomorrow/);
});

test('group chats are ignored', async () => {
  const { bot, sent, store } = setup();
  await bot.handleUpdate({ message: { chat: { id: -5, type: 'group' }, location: TOKYO } });
  assert.equal(sent.length, 0);
  assert.equal(store.getLocation('-5'), undefined);
});

test('blocking the bot deletes the saved location, unblocking does not', async () => {
  const { bot, store, share } = setup();
  await share();
  const member = (status) => ({ my_chat_member: { chat: privateChat, new_chat_member: { status } } });
  await bot.handleUpdate(member('member'));
  assert.deepEqual(store.getLocation(USER), SAVED_TOKYO);
  await bot.handleUpdate(member('kicked'));
  assert.equal(store.getLocation(USER), undefined);
});

test('a saved user is still recognised after a restart, despite numeric chat IDs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'weatherbot-'));
  try {
    const path = join(dir, 'users.json');
    await setup({ store: createStore(path) }).share();
    const { sent, say } = setup({ store: createStore(path) });
    await say('today');
    assert.match(sent[0].text, /Today, Wed 4 Nov/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('unknown update types are ignored', async () => {
  const { bot, sent } = setup();
  await bot.handleUpdate({ update_id: 1 });
  assert.equal(sent.length, 0);
});
