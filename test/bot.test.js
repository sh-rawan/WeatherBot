import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBot } from '../src/bot.js';
import { createMemoryStore } from '../src/store.js';

const CHAT_ID = 111;
const USER = String(CHAT_ID);
const TOKYO = { latitude: 35.68, longitude: 139.76 };
const SAVED_TOKYO = { lat: 35.68, lon: 139.76, timezone: 'Asia/Tokyo' };
const TODAY_ICONS = '🚫-🚫-🚫-🚫';
const TOMORROW_ICONS = '☔-🚫-🚫-🚫';
const HELP = 'ℹ️ Help';
const STOP = '🔕 Stop notifications';
const RESUME = '🔔 Turn on notifications';

// Reads the weather tiles of a card, as morning-afternoon-evening-night.
const iconsIn = (keyboard) => keyboard.inline_keyboard[1].map((tile) => tile.text).join('-');

// Today is dry, and tomorrow morning needs an umbrella.
const forecast = (timezone = 'Asia/Tokyo') => {
  const size = 72;
  const precipitation = Array(size).fill(0);
  precipitation[24 + 9] = 3;
  return {
    timezone,
    hourly: {
      time: Array.from({ length: size }, (_, i) => `2026-11-0${4 + Math.floor(i / 24)}T00:00`),
      temperature_2m: Array(size).fill(25),
      precipitation,
      precipitation_probability: Array(size).fill(0),
      weather_code: Array(size).fill(3),
      wind_gusts_10m: Array(size).fill(5),
    },
  };
};

const privateChat = { id: CHAT_ID, type: 'private' };

function setup({ fetchForecast = async () => forecast(), store = createMemoryStore(), adminId } = {}) {
  const sent = [];
  const buttonNotes = [];
  const keyboardUpdates = [];
  const messenger = {
    sendText: async (to, text, keyboard) => ({ message_id: sent.push({ to, text, keyboard }) }),
    answerButton: async (id, text) => buttonNotes.push({ id, text }),
    setMessageKeyboard: async (to, messageId, keyboard) => keyboardUpdates.push({ to, messageId, keyboard }),
  };
  const bot = createBot({ messenger, store, fetchForecast, adminId, log: { error() {} } });
  const send = (fields) => bot.handleUpdate({ update_id: 1, message: { chat: privateChat, ...fields } });
  const say = (text) => send({ text });
  const share = (location = TOKYO) => send({ location });
  const tap = (data, messageId) =>
    bot.handleUpdate({ callback_query: { id: 'tap1', data, message: { message_id: messageId, chat: privateChat } } });
  return { bot, sent, store, say, share, send, tap, buttonNotes, keyboardUpdates };
}

const firstButton = (keyboard) => keyboard.keyboard[0][0];
const lastRow = (keyboard) => keyboard.keyboard.at(-1).map((button) => button.text);

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
  assert.deepEqual(await store.getLocation(USER), SAVED_TOKYO);
  assert.deepEqual(calls, [[35.68, 139.76]]);
  assert.ok(sent[0].text.includes('🌅  🚫'));
  assert.ok(sent[0].text.includes('🌙  🚫'));
  assert.equal(firstButton(sent[0].keyboard).text, 'Today');
});

test('sharing a location explains the notifications and points to Help', async () => {
  const { sent, share } = setup();
  await share();
  assert.match(sent[0].text, /Every evening around 20:00/);
  assert.ok(sent[0].text.includes(HELP));
});

for (const timezone of ['Asia/Tokyo', 'Asia/Kuala_Lumpur', 'Asia/Kuching', 'Asia/Kolkata', 'Asia/Calcutta']) {
  test(`a location in ${timezone} is accepted and saved with its timezone`, async () => {
    const { sent, store, share } = setup({ fetchForecast: async () => forecast(timezone) });
    await share();
    assert.equal((await store.getLocation(USER)).timezone, timezone);
    assert.match(sent[0].text, /Location saved/);
  });
}

for (const timezone of ['Asia/Seoul', 'Asia/Singapore', 'Asia/Brunei', 'Asia/Colombo', 'Asia/Dhaka', 'Asia/Karachi']) {
  test(`a location in ${timezone} is declined and not saved`, async () => {
    const { sent, store, share } = setup({ fetchForecast: async () => forecast(timezone) });
    await share();
    assert.equal(await store.getLocation(USER), undefined);
    assert.match(sent[0].text, /only cover Japan, Malaysia and India/);
    assert.equal(firstButton(sent[0].keyboard).request_location, true);
  });
}

test('a location outside the covered countries keeps the previously saved one', async () => {
  let timezone = 'Asia/Tokyo';
  const { sent, store, share } = setup({ fetchForecast: async () => forecast(timezone) });
  await share();
  timezone = 'Asia/Taipei';
  await share({ latitude: 25.03, longitude: 121.57 });
  assert.deepEqual(await store.getLocation(USER), SAVED_TOKYO);
  assert.match(sent[1].text, /only cover Japan, Malaysia and India/);
  assert.equal(firstButton(sent[1].keyboard).text, 'Today');
});

test('a location is not saved when the forecast check fails', async () => {
  const { sent, store, share } = setup({
    fetchForecast: async () => {
      throw new Error('down');
    },
  });
  await share();
  assert.equal(await store.getLocation(USER), undefined);
  assert.match(sent[0].text, /couldn't get the forecast/);
});

test('Today and Tomorrow reply with an icons-only card for that day', async () => {
  const { sent, say, share } = setup();
  await share();
  await say('Today');
  await say('Tomorrow');
  assert.equal(sent[1].text, '🚫 · 🚫 · 🚫 · 🚫');
  assert.equal(iconsIn(sent[1].keyboard), TODAY_ICONS);
  assert.equal(sent[2].text, '☔ · 🚫 · 🚫 · 🚫');
  assert.equal(iconsIn(sent[2].keyboard), TOMORROW_ICONS);
});

const buttonTexts = (keyboard) => keyboard.inline_keyboard.flat().map((b) => b.text);

test('a card is a grid of tiles with like and dislike buttons below', async () => {
  const { sent, say, share } = setup();
  await share();
  await say('Tomorrow');
  const rows = sent[1].keyboard.inline_keyboard;
  assert.deepEqual(rows[0].map((b) => b.text), ['🌅', '🌞', '🌇', '🌙']);
  assert.deepEqual(rows[1].map((b) => b.text), ['☔', '🚫', '🚫', '🚫']);
  assert.deepEqual(rows[2].map((b) => b.text), ['👍', '👎']);
  assert.deepEqual(rows[2].map((b) => b.callback_data), ['like', 'dislike']);
  assert.doesNotMatch(sent[1].text, /[A-Za-z0-9]/);
});

test('a reaction keeps the tiles and ticks the choice', async () => {
  const { sent, say, share, bot, keyboardUpdates } = setup();
  await share();
  await say('Tomorrow');
  await bot.handleUpdate({
    callback_query: {
      id: 'tap',
      data: 'like',
      message: { message_id: 2, chat: privateChat, reply_markup: sent[1].keyboard },
    },
  });
  const rows = keyboardUpdates[0].keyboard.inline_keyboard;
  assert.deepEqual(rows.slice(0, 2), sent[1].keyboard.inline_keyboard.slice(0, 2));
  assert.deepEqual(rows[2].map((b) => b.text), ['✅ 👍', '👎']);
});

test('tapping a tile does nothing but stop the spinner', async () => {
  const { store, say, share, tap, buttonNotes, keyboardUpdates } = setup();
  await share();
  await say('Today');
  await tap('tile', 2);
  assert.equal((await store.getSuggestions(USER))[0].reaction, 'none');
  assert.deepEqual(buttonNotes, [{ id: 'tap1', text: undefined }]);
  assert.equal(keyboardUpdates.length, 0);
});

test('requested cards are logged with no reaction yet', async () => {
  const { store, say, share } = setup();
  await share();
  await say('Today');
  await say('Tomorrow');
  const logged = await store.getSuggestions(USER);
  assert.deepEqual(logged.map((s) => s.source), ['today', 'tomorrow']);
  assert.deepEqual(logged.map((s) => s.reaction), ['none', 'none']);
  assert.deepEqual(logged.map((s) => s.reasons), [['requested'], ['requested']]);
  assert.deepEqual(logged.map((s) => s.messageId), [2, 3]);
  assert.deepEqual(logged.map((s) => s.forecastDate), ['2026-11-04', '2026-11-05']);
  assert.equal(logged[1].icons, TOMORROW_ICONS);
});

test('the location message has no like buttons and is not logged', async () => {
  const { sent, store, share } = setup();
  await share();
  assert.equal(sent[0].keyboard.inline_keyboard, undefined);
  assert.deepEqual(await store.getSuggestions(USER), []);
});

test('tapping a button logs it, thanks the user and ticks that button', async () => {
  const { store, say, share, tap, buttonNotes, keyboardUpdates } = setup();
  await share();
  await say('Today');
  await tap('like', 2);
  assert.equal((await store.getSuggestions(USER))[0].reaction, 'like');
  assert.deepEqual(buttonNotes, [{ id: 'tap1', text: 'Thanks for the feedback!' }]);
  assert.equal(keyboardUpdates[0].to, USER);
  assert.equal(keyboardUpdates[0].messageId, 2);
  assert.deepEqual(buttonTexts(keyboardUpdates[0].keyboard), ['✅ 👍', '👎']);
});

test('a user can change their mind', async () => {
  const { store, say, share, tap, keyboardUpdates } = setup();
  await share();
  await say('Today');
  await tap('like', 2);
  await tap('dislike', 2);
  assert.equal((await store.getSuggestions(USER))[0].reaction, 'dislike');
  assert.deepEqual(buttonTexts(keyboardUpdates[1].keyboard), ['👍', '✅ 👎']);
});

test('an unknown button value is not logged, but the spinner still stops', async () => {
  const { store, say, share, tap, buttonNotes, keyboardUpdates } = setup();
  await share();
  await say('Today');
  await tap('constructor', 2);
  assert.equal((await store.getSuggestions(USER))[0].reaction, 'none');
  assert.equal(buttonNotes.length, 1);
  assert.equal(keyboardUpdates.length, 0);
});

test('a failure to log still leaves the delivered card alone', async () => {
  const store = createMemoryStore();
  store.logSuggestion = async () => {
    throw new Error('database down');
  };
  const { sent, say, share } = setup({ store });
  await share();
  await say('Today');
  assert.equal(iconsIn(sent[1].keyboard), TODAY_ICONS);
});

test('button taps from group chats are ignored', async () => {
  const { bot, buttonNotes } = setup();
  await bot.handleUpdate({ callback_query: { id: 'x', data: 'like', message: { message_id: 1, chat: { id: -5, type: 'group' } } } });
  assert.equal(buttonNotes.length, 0);
});

test('Today and Tomorrow work when typed, regardless of case', async () => {
  const { sent, say, share } = setup();
  await share();
  await say(' tomorrow ');
  await say('TODAY');
  assert.equal(iconsIn(sent[1].keyboard), TOMORROW_ICONS);
  assert.equal(iconsIn(sent[2].keyboard), TODAY_ICONS);
});

test('Today and Tomorrow explain when the forecast fails', async () => {
  let fail = false;
  const { sent, say, share } = setup({
    fetchForecast: async () => {
      if (fail) throw new Error('down');
      return forecast();
    },
  });
  await share();
  fail = true;
  await say('Today');
  assert.match(sent[1].text, /couldn't get the forecast/);
});

test('the Help button is the bottom row of both keyboards', async () => {
  const { sent, say, share } = setup();
  await say('/start');
  assert.deepEqual(lastRow(sent[0].keyboard), [HELP]);
  await share();
  assert.deepEqual(lastRow(sent[1].keyboard), [HELP]);
});

test('Help explains the icons, timings, notifications and who to contact', async () => {
  const { sent, say } = setup();
  await say(HELP);
  const { text } = sent[0];
  for (const icon of ['☔', '🌦️', '🍃', '🧥', '❄️', '☀️', '🚫']) assert.ok(text.includes(icon), `missing ${icon}`);
  for (const part of ['🌅', '🌞', '🌇', '🌙']) assert.ok(text.includes(part), `missing ${part}`);
  for (const timing of ['06:00–12:00', '12:00–18:00', '18:00–24:00', '00:00–06:00']) {
    assert.ok(text.includes(timing), `missing ${timing}`);
  }
  assert.match(text, /23°C or below/);
  assert.match(text, /15°C or below/);
  assert.match(text, /below 5°C/);
  assert.match(text, /Sweaty hot, or sunny/);
  assert.match(text, /20:00 your local time/);
  assert.match(text, /Contact Shrawan/);
});

test('Help works before a location is shared, and keeps the right keyboard', async () => {
  const { sent, say, share } = setup();
  await say('help');
  assert.match(sent[0].text, /What the icons mean/);
  assert.equal(firstButton(sent[0].keyboard).request_location, true);
  await share();
  await say('/help');
  assert.match(sent[2].text, /What the icons mean/);
  assert.equal(firstButton(sent[2].keyboard).text, 'Today');
});

test('Help text has balanced bold markers, so Telegram can format it', async () => {
  const { sent, say } = setup();
  await say(HELP);
  assert.equal(sent[0].text.split('*').length % 2, 1);
  assert.doesNotMatch(sent[0].text, /[_`[]/);
});

test('the admin gets a test card for today from /test, logged as a test', async () => {
  const { sent, store, say, share } = setup({ adminId: CHAT_ID });
  await share();
  await say('/test');
  assert.equal(sent[1].to, USER);
  assert.equal(iconsIn(sent[1].keyboard), TODAY_ICONS);
  const [logged] = await store.getSuggestions(USER);
  assert.equal(logged.source, 'test');
  assert.deepEqual(logged.reasons, ['test']);
});

test('/test from anyone but the admin does nothing special', async () => {
  const { sent, store, say, share } = setup({ adminId: 222 });
  await share();
  await say('/test');
  assert.match(sent[1].text, /Choose Today or Tomorrow/);
  assert.deepEqual(await store.getSuggestions(USER), []);
});

test('/test does nothing when no admin is set', async () => {
  const { sent, say, share } = setup();
  await share();
  await say('/test');
  assert.match(sent[1].text, /Choose Today or Tomorrow/);
});

test('/test from an admin with no location asks for one', async () => {
  const { sent, say } = setup({ adminId: CHAT_ID });
  await say('/test');
  assert.match(sent[0].text, /need your location/);
});

test('sendTestCard only messages the admin, even with other users saved', async () => {
  const store = createMemoryStore();
  await store.setLocation('other', SAVED_TOKYO);
  await store.setLocation('admin', SAVED_TOKYO);
  const { bot, sent } = setup({ store, adminId: 'admin' });
  await bot.sendTestCard();
  assert.deepEqual(sent.map((m) => m.to), ['admin']);
  assert.deepEqual(await store.getSuggestions('other'), []);
});

test('sendTestCard fails clearly with no admin or no saved location', async () => {
  await assert.rejects(setup().bot.sendTestCard(), /No admin is set/);
  await assert.rejects(setup({ adminId: 'admin' }).bot.sendTestCard(), /no saved location/);
});

const allButtons = (keyboard) => keyboard.keyboard.flat().map((button) => button.text);

test('the main menu has a stop button, and the first menu does not', async () => {
  const { sent, say, share } = setup();
  await say('/start');
  assert.ok(!allButtons(sent[0].keyboard).includes(STOP));
  await share();
  assert.ok(allButtons(sent[1].keyboard).includes(STOP));
  assert.deepEqual(lastRow(sent[1].keyboard), [HELP]);
});

test('tapping stop turns notifications off, confirms it, and offers to turn them on', async () => {
  const { sent, store, say, share } = setup();
  await share();
  await say(STOP);
  assert.match((await store.getLocation(USER)).notificationsOffAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(sent[1].text, /notifications are off/);
  assert.ok(allButtons(sent[1].keyboard).includes(RESUME));
  assert.ok(!allButtons(sent[1].keyboard).includes(STOP));
});

test('tapping turn on brings notifications back and restores the stop button', async () => {
  const { sent, store, say, share } = setup();
  await share();
  await say(STOP);
  await say(RESUME);
  assert.equal((await store.getLocation(USER)).notificationsOffAt, undefined);
  assert.match(sent[2].text, /notifications are on/);
  assert.ok(allButtons(sent[2].keyboard).includes(STOP));
});

test('tapping stop twice keeps the original time', async () => {
  const { store, say, share } = setup();
  await share();
  await say(STOP);
  const first = (await store.getLocation(USER)).notificationsOffAt;
  await store.setNotificationsOff(USER, '2020-01-01T00:00:00.000Z');
  await say(STOP);
  assert.equal((await store.getLocation(USER)).notificationsOffAt, '2020-01-01T00:00:00.000Z');
  assert.ok(first);
});

test('Today, Tomorrow and the menu still work with notifications off', async () => {
  const { sent, say, share } = setup();
  await share();
  await say(STOP);
  await say('Tomorrow');
  assert.equal(iconsIn(sent[2].keyboard), TOMORROW_ICONS);
  await say('hello');
  assert.ok(allButtons(sent[3].keyboard).includes(RESUME));
});

test('moving location with notifications off keeps them off and says so', async () => {
  const { sent, store, say, share } = setup();
  await share();
  await say(STOP);
  await share();
  assert.ok((await store.getLocation(USER)).notificationsOffAt);
  assert.match(sent[2].text, /notifications are off/);
  assert.doesNotMatch(sent[2].text, /Every evening/);
  assert.ok(allButtons(sent[2].keyboard).includes(RESUME));
});

test('tapping stop before sharing a location asks for one', async () => {
  const { sent, say } = setup();
  await say(STOP);
  assert.match(sent[0].text, /need your location/);
});

test('Help explains how to stop notifications', async () => {
  const { sent, say } = setup();
  await say(HELP);
  assert.match(sent[0].text, /Tap 🔕 to stop/);
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
  assert.equal(await store.getLocation('-5'), undefined);
});

test('blocking the bot deletes the saved location, unblocking does not', async () => {
  const { bot, store, share } = setup();
  await share();
  const member = (status) => ({ my_chat_member: { chat: privateChat, new_chat_member: { status } } });
  await bot.handleUpdate(member('member'));
  assert.deepEqual(await store.getLocation(USER), SAVED_TOKYO);
  await bot.handleUpdate(member('kicked'));
  assert.equal(await store.getLocation(USER), undefined);
});

test('users are saved under a text ID, though Telegram sends a number', async () => {
  const store = createMemoryStore();
  await setup({ store }).share();
  assert.deepEqual(await store.getLocation(USER), SAVED_TOKYO);
  assert.equal(await store.getLocation(CHAT_ID), undefined);
  const { sent, say } = setup({ store });
  await say('today');
  assert.equal(iconsIn(sent[0].keyboard), TODAY_ICONS);
});

test('unknown update types are ignored', async () => {
  const { bot, sent } = setup();
  await bot.handleUpdate({ update_id: 1 });
  assert.equal(sent.length, 0);
});
