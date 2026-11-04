import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createNotifier, shouldSend } from '../src/notifier.js';
import { createStore } from '../src/store.js';

const KEYBOARD = { Buttons: [] };
const PAST_DAYS = 7;
const TODAY_START = PAST_DAYS * 24;
const TOMORROW_START = TODAY_START + 24;

// `recentTempC` covers the past week and today. `tempC` covers tomorrow onwards.
const forecast = ({ rainy = true, tempC = 15, recentTempC = 15 } = {}) => {
  const size = (PAST_DAYS + 3) * 24;
  const probability = Array(size).fill(0);
  if (rainy) probability[TOMORROW_START + 9] = 80; // Timestamp 09:00 means rain from 08:00 to 09:00.
  return {
    timezone: 'Asia/Tokyo',
    pastDays: PAST_DAYS,
    hourly: {
      time: Array.from({ length: size }, (_, i) =>
        new Date(Date.UTC(2026, 9, 28, i)).toISOString().slice(0, 16),
      ),
      temperature_2m: Array.from({ length: size }, (_, i) => (i < TOMORROW_START ? recentTempC : tempC)),
      precipitation: Array(size).fill(0),
      precipitation_probability: probability,
      weather_code: Array(size).fill(3),
      wind_gusts_10m: Array(size).fill(5),
    },
  };
};

function setup({ time = '2026-11-04T20:00:00+09:00', fetchForecast = async () => forecast(), users = ['u1'] } = {}) {
  const sent = [];
  const store = createStore();
  for (const id of users) store.setLocation(id, { lat: 35.68, lon: 139.76, timezone: 'Asia/Tokyo' });
  const state = { time };
  const notifier = createNotifier({
    messenger: { sendText: async (to, text, keyboard) => sent.push({ to, text, keyboard }) },
    store,
    fetchForecast,
    keyboard: KEYBOARD,
    now: () => new Date(state.time).getTime(),
    log: { error() {} },
  });
  return { notifier, sent, store, state };
}

const outlookWith = (...weather) => ({ rain: false, weather });

test('rain always sends, even when the cold is already normal', () => {
  assert.equal(shouldSend({ rain: true, weather: ['cold'] }, [outlookWith('cold')]), true);
});

test('cold or hot that did not happen recently sends', () => {
  assert.equal(shouldSend(outlookWith('cold'), [outlookWith()]), true);
  assert.equal(shouldSend(outlookWith('hot'), [outlookWith('cold')]), true);
});

test('cold or hot that already happened recently is normal, so stays quiet', () => {
  assert.equal(shouldSend(outlookWith('cold'), [outlookWith(), outlookWith('cold')]), false);
  assert.equal(shouldSend(outlookWith('hot'), [outlookWith('hot')]), false);
});

test('getting much colder needs different clothes, so it sends', () => {
  assert.equal(shouldSend(outlookWith('veryCold'), [outlookWith('cold')]), true);
});

test('warming from very cold to cold needs no new clothes, so stays quiet', () => {
  assert.equal(shouldSend(outlookWith('cold'), [outlookWith('veryCold')]), false);
});

test('a day with nothing to report never sends', () => {
  assert.equal(shouldSend(outlookWith(), []), false);
});

test('nothing is checked before 20:00 Japan time', async () => {
  let calls = 0;
  const { notifier, sent } = setup({
    time: '2026-11-04T19:59:00+09:00',
    fetchForecast: async () => {
      calls++;
      return forecast();
    },
  });
  await notifier.checkAll();
  assert.equal(calls, 0);
  assert.equal(sent.length, 0);
});

test('at 20:00 Japan time, a rainy tomorrow sends only the four icons', async () => {
  const { notifier, sent } = setup();
  await notifier.checkAll();
  assert.deepEqual(sent, [{ to: 'u1', text: '☔-🚫-🚫-🚫', keyboard: KEYBOARD }]);
});

test('Japan time is used whatever the server clock zone: 20:00 JST is 11:00 UTC', async () => {
  const { notifier, sent } = setup({ time: '2026-11-04T11:00:00Z' });
  await notifier.checkAll();
  assert.equal(sent.length, 1);
});

test('each user is checked at 20:00 in their own timezone', async () => {
  const { notifier, sent, store, state } = setup({ users: [] });
  store.setLocation('tokyo', { lat: 35.68, lon: 139.76, timezone: 'Asia/Tokyo' });
  store.setLocation('kl', { lat: 3.14, lon: 101.69, timezone: 'Asia/Kuala_Lumpur' });
  store.setLocation('delhi', { lat: 28.61, lon: 77.21, timezone: 'Asia/Kolkata' });

  const checkAt = async (time) => {
    state.time = time;
    await notifier.checkAll();
    return sent.map((m) => m.to);
  };

  assert.deepEqual(await checkAt('2026-11-04T10:59:00Z'), []);
  assert.deepEqual(await checkAt('2026-11-04T11:00:00Z'), ['tokyo']); // 20:00 in Tokyo.
  assert.deepEqual(await checkAt('2026-11-04T11:59:00Z'), ['tokyo']);
  assert.deepEqual(await checkAt('2026-11-04T12:00:00Z'), ['tokyo', 'kl']); // 20:00 in Kuala Lumpur.
  assert.deepEqual(await checkAt('2026-11-04T14:29:00Z'), ['tokyo', 'kl']);
  assert.deepEqual(await checkAt('2026-11-04T14:30:00Z'), ['tokyo', 'kl', 'delhi']); // 20:00 in India.
});

test('a user past local midnight waits for their next evening', async () => {
  const { notifier, sent, store, state } = setup({ users: [] });
  store.setLocation('delhi', { lat: 28.61, lon: 77.21, timezone: 'Asia/Kolkata' });
  state.time = '2026-11-04T18:30:00Z'; // 00:00 on Nov 5 in India.
  await notifier.checkAll();
  assert.equal(sent.length, 0);
});

test('midnight local time counts as hour 0, not 24', async () => {
  const { notifier, sent, state } = setup();
  state.time = '2026-11-04T15:00:00Z'; // 00:00 on Nov 5 in Tokyo.
  await notifier.checkAll();
  assert.equal(sent.length, 0);
});

test('rain sends every evening of a long rainy spell, but only once per evening', async () => {
  const { notifier, sent, state } = setup();
  for (let day = 4; day <= 10; day++) {
    state.time = `2026-11-${String(day).padStart(2, '0')}T20:00:00+09:00`;
    await notifier.checkAll();
    await notifier.checkAll();
  }
  assert.equal(sent.length, 7);
});

test('rain today does not trigger a message about tomorrow', async () => {
  const data = forecast({ rainy: false });
  data.hourly.precipitation_probability[TODAY_START + 9] = 90;
  const { notifier, sent } = setup({ fetchForecast: async () => data });
  await notifier.checkAll();
  assert.equal(sent.length, 0);
});

test('a mild dry tomorrow sends nothing and is not checked again that day', async () => {
  let calls = 0;
  const { notifier, sent } = setup({
    fetchForecast: async () => {
      calls++;
      return forecast({ rainy: false });
    },
  });
  await notifier.checkAll();
  await notifier.checkAll();
  assert.equal(sent.length, 0);
  assert.equal(calls, 1);
});

test('the first cold day after a mild week sends a message', async () => {
  const { notifier, sent } = setup({ fetchForecast: async () => forecast({ rainy: false, tempC: 5 }) });
  await notifier.checkAll();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, '🧣-🧣-🧣-🧣');
});

test('another cold day in a cold week sends nothing', async () => {
  const { notifier, sent } = setup({
    fetchForecast: async () => forecast({ rainy: false, tempC: 5, recentTempC: 5 }),
  });
  await notifier.checkAll();
  assert.equal(sent.length, 0);
});

test('cold from exactly a week ago still counts, but eight days ago does not', async () => {
  const withColdDay = (daysAgo) => {
    const data = forecast({ rainy: false, tempC: 5 });
    const start = TODAY_START - daysAgo * 24;
    for (let i = start + 6; i < start + 12; i++) data.hourly.temperature_2m[i] = 5;
    return data;
  };
  const counted = setup({ fetchForecast: async () => withColdDay(6) });
  await counted.notifier.checkAll();
  assert.equal(counted.sent.length, 0);
  const tooOld = setup({ fetchForecast: async () => withColdDay(7) });
  await tooOld.notifier.checkAll();
  assert.equal(tooOld.sent.length, 1);
});

test('a failed forecast is retried on the next check', async () => {
  let fail = true;
  const { notifier, sent } = setup({
    fetchForecast: async () => {
      if (fail) throw new Error('down');
      return forecast();
    },
  });
  await notifier.checkAll();
  assert.equal(sent.length, 0);
  fail = false;
  await notifier.checkAll();
  assert.equal(sent.length, 1);
});

test('a failed send is retried and not recorded as checked', async () => {
  const store = createStore();
  store.setLocation('u1', { lat: 35.68, lon: 139.76, timezone: 'Asia/Tokyo' });
  let fail = true;
  const delivered = [];
  const notifier = createNotifier({
    messenger: {
      sendText: async (to, text) => {
        if (fail) throw new Error('send down');
        delivered.push(text);
      },
    },
    store,
    fetchForecast: async () => forecast(),
    keyboard: KEYBOARD,
    now: () => new Date('2026-11-04T20:00:00+09:00').getTime(),
    log: { error() {} },
  });
  await notifier.checkAll();
  assert.equal(store.getLocation('u1').lastCheckedDate, undefined);
  fail = false;
  await notifier.checkAll();
  assert.equal(delivered.length, 1);
});

test('one user failing does not stop the others', async () => {
  let calls = 0;
  const { notifier, sent } = setup({
    users: ['u1', 'u2'],
    fetchForecast: async () => {
      if (++calls === 1) throw new Error('down');
      return forecast();
    },
  });
  await notifier.checkAll();
  assert.deepEqual(sent.map((m) => m.to), ['u2']);
});

test('moving location gets checked again tonight', async () => {
  const { notifier, sent, store } = setup();
  await notifier.checkAll();
  store.setLocation('u1', { lat: 43.06, lon: 141.35, timezone: 'Asia/Tokyo' });
  await notifier.checkAll();
  assert.equal(sent.length, 2);
});

test('the checked date survives a restart, so nothing is sent twice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weatherbot-'));
  try {
    const path = join(dir, 'users.json');
    const store = createStore(path);
    store.setLocation('u1', { lat: 35.68, lon: 139.76 });
    store.updateUser('u1', { lastCheckedDate: '2026-11-04' });
    assert.equal(createStore(path).getLocation('u1').lastCheckedDate, '2026-11-04');
  } finally {
    rmSync(dir, { recursive: true });
  }
});
