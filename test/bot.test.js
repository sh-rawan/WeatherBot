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

// Reads the icons back out of a day card, as morning-afternoon-evening-night.
const iconsIn = (text) => text.split('\n').slice(2).map((line) => line.split('  ')[0]).join('-');

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

function setup({ fetchForecast = async () => forecast(), store = createMemoryStore() } = {}) {
  const sent = [];
  const buttonNotes = [];
  const keyboardUpdates = [];
  const messenger = {
    sendText: async (to, text, keyboard) => ({ message_id: sent.push({ to, text, keyboard }) }),
    answerButton: async (id, text) => buttonNotes.push({ id, text }),
    setMessageKeyboard: async (to, messageId, keyboard) => keyboardUpdates.push({ to, messageId, keyboard }),
  };
  const bot = createBot({ messenger, store, fetchForecast, log: { error() {} } });
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
  assert.match(sent[0].text, /Today · Wed 4 Nov/);
  assert.match(sent[0].text, /🚫  Night/);
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

test('Today and Tomorrow reply with a dated card for that day', async () => {
  const { sent, say, share } = setup();
  await share();
  await say('Today');
  await say('Tomorrow');
  assert.equal(sent[1].text, '*Today · Wed 4 Nov*\n\n🚫  Morning\n🚫  Afternoon\n🚫  Evening\n🚫  Night');
  assert.equal(sent[2].text, '*Tomorrow · Thu 5 Nov*\n\n☔  Morning\n🚫  Afternoon\n🚫  Evening\n🚫  Night');
});

const buttonTexts = (keyboard) => keyboard.inline_keyboard.flat().map((b) => b.text);

test('Today and Tomorrow cards have like and dislike buttons', async () => {
  const { sent, say, share } = setup();
  await share();
  await say('Today');
  assert.deepEqual(buttonTexts(sent[1].keyboard), ['👍', '👎']);
  assert.deepEqual(sent[1].keyboard.inline_keyboard.flat().map((b) => b.callback_data), ['like', 'dislike']);
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
  assert.equal(iconsIn(sent[1].text), TODAY_ICONS);
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
  assert.equal(iconsIn(sent[1].text), TOMORROW_ICONS);
  assert.equal(iconsIn(sent[2].text), TODAY_ICONS);
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
  assert.equal(iconsIn(sent[0].text), TODAY_ICONS);
});

test('unknown update types are ignored', async () => {
  const { bot, sent } = setup();
  await bot.handleUpdate({ update_id: 1 });
  assert.equal(sent.length, 0);
});
