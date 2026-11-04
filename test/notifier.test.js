import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNotifier, shouldSend, temperatureChangeStarts } from '../src/notifier.js';
import { createMemoryStore } from '../src/store.js';

// Reads the weather tiles of a card, as morning-afternoon-evening-night.
const iconsIn = (keyboard) => keyboard.inline_keyboard[1].map((tile) => tile.text).join('-');
const PAST_DAYS = 7;
const TODAY_START = PAST_DAYS * 24;
const TOMORROW_START = TODAY_START + 24;

// `recentTempC` covers the past week and today. `tempC` covers tomorrow onwards.
const forecast = ({ rainy = true, lightRain = false, tempC = 25, recentTempC = 25 } = {}) => {
  const size = (PAST_DAYS + 3) * 24;
  const probability = Array(size).fill(0);
  const precipitation = Array(size).fill(0);
  const rainIndex = TOMORROW_START + 9; // Timestamp 09:00 means rain from 08:00 to 09:00.
  if (lightRain) {
    probability[rainIndex] = 55;
  } else if (rainy) {
    probability[rainIndex] = 80;
    precipitation[rainIndex] = 3;
  }
  return {
    timezone: 'Asia/Tokyo',
    pastDays: PAST_DAYS,
    hourly: {
      time: Array.from({ length: size }, (_, i) =>
        new Date(Date.UTC(2026, 9, 28, i)).toISOString().slice(0, 16),
      ),
      temperature_2m: Array.from({ length: size }, (_, i) => (i < TOMORROW_START ? recentTempC : tempC)),
      precipitation,
      precipitation_probability: probability,
      weather_code: Array(size).fill(3),
      wind_gusts_10m: Array(size).fill(5),
    },
  };
};

function setup({ time = '2026-11-04T20:00:00+09:00', fetchForecast = async () => forecast(), users = ['u1'] } = {}) {
  const sent = [];
  const store = createMemoryStore();
  for (const id of users) store.setLocation(id, { lat: 35.68, lon: 139.76, timezone: 'Asia/Tokyo' });
  const state = { time };
  const notifier = createNotifier({
    messenger: {
      sendText: async (to, text, keyboard) => ({ message_id: sent.push({ to, text, keyboard }) }),
    },
    store,
    fetchForecast,
    now: () => new Date(state.time).getTime(),
    log: { error() {} },
  });
  return { notifier, sent, store, state };
}

const outlookWith = (...weather) => ({ umbrella: false, weather });

test('needing an umbrella always sends, even when the cold is already normal', () => {
  assert.equal(shouldSend({ umbrella: true, weather: ['cold'] }, [outlookWith('cold')]), true);
});

test('a sent card is logged with its reasons and weather, with no reaction yet', async () => {
  const { notifier, store } = setup();
  await notifier.checkAll();
  const [logged, ...others] = await store.getSuggestions('u1');
  assert.equal(others.length, 0);
  assert.equal(logged.messageId, 1);
  assert.equal(logged.source, 'evening');
  assert.equal(logged.reaction, 'none');
  assert.deepEqual(logged.reasons, ['umbrella']);
  assert.equal(logged.icons, '☔-🚫-🚫-🚫');
  assert.equal(logged.forecastDate, '2026-11-05');
  assert.equal(logged.timezone, 'Asia/Tokyo');
  assert.equal(logged.sentAt, '2026-11-04T11:00:00.000Z');
  assert.equal(logged.snapshot.changeC, 0);
  assert.deepEqual(logged.snapshot.parts.map((p) => p.name), ['Morning', 'Afternoon', 'Evening', 'Night']);
  assert.equal(logged.snapshot.parts[0].rainMm, 3);
  assert.equal(logged.snapshot.parts[0].rainChance, 80);
  assert.equal(logged.snapshot.parts[0].coldestC, 25);
  assert.equal(logged.snapshot.parts[0].minFeelsC, 25);
});

test('each reason that applies is logged', async () => {
  const { notifier, store } = setup({ fetchForecast: async () => forecast({ tempC: 5 }) });
  await notifier.checkAll();
  assert.deepEqual((await store.getSuggestions('u1'))[0].reasons, ['umbrella', 'temperature', 'clothes']);
});

test('a day with no message logs no card, but is still marked as checked', async () => {
  const { notifier, store } = setup({ fetchForecast: async () => forecast({ rainy: false }) });
  await notifier.checkAll();
  assert.deepEqual(await store.getSuggestions('u1'), []);
  assert.equal((await store.getLocation('u1')).lastCheckedDate, '2026-11-04');
});

test('a user with notifications off gets nothing, and is not checked', async () => {
  let calls = 0;
  const { notifier, sent, store } = setup({
    fetchForecast: async () => {
      calls++;
      return forecast();
    },
  });
  await store.setNotificationsOff('u1', '2026-11-04T01:00:00.000Z');
  await notifier.checkAll();
  assert.equal(sent.length, 0);
  assert.equal(calls, 0);
  assert.equal((await store.getLocation('u1')).lastCheckedDate, undefined);
});

test('users with notifications off do not use up a run', async () => {
  const { notifier, sent, store } = setup({ users: ['a', 'b', 'c', 'd'] });
  for (const id of ['a', 'b', 'c']) await store.setNotificationsOff(id, '2026-11-04T01:00:00.000Z');
  await notifier.checkAll();
  assert.deepEqual(sent.map((m) => m.to), ['d']);
});

test('turning notifications back on before midnight still gets that evening checked', async () => {
  const { notifier, sent, store } = setup();
  await store.setNotificationsOff('u1', '2026-11-04T01:00:00.000Z');
  await notifier.checkAll();
  await store.setNotificationsOff('u1', null);
  await notifier.checkAll();
  assert.equal(sent.length, 1);
});

test('light rain alone sends nothing', async () => {
  const { notifier, sent } = setup({ fetchForecast: async () => forecast({ lightRain: true }) });
  await notifier.checkAll();
  assert.equal(sent.length, 0);
});

test('light rain still shows its icon when something else sends a message', async () => {
  const { notifier, sent } = setup({
    fetchForecast: async () => forecast({ lightRain: true, tempC: 5 }),
  });
  await notifier.checkAll();
  assert.equal(iconsIn(sent[0].keyboard), '🌦️🧥-🧥-🧥-🧥');
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

test('a temperature change sends even when the clothes are already normal', () => {
  assert.equal(shouldSend(outlookWith('cold'), [outlookWith('cold')], true), true);
});

// Daily averages: yesterday, today, tomorrow.
test('a change of 4°C from today counts, in either direction', () => {
  assert.equal(temperatureChangeStarts([12, 12, 8]), true);
  assert.equal(temperatureChangeStarts([12, 12, 16]), true);
});

test('a change of under 4°C does not count', () => {
  assert.equal(temperatureChangeStarts([12, 12, 8.1]), false);
  assert.equal(temperatureChangeStarts([12, 12, 15.9]), false);
  assert.equal(temperatureChangeStarts([12, 12, 12]), false);
});

test('a fall continuing from today does not send again', () => {
  assert.equal(temperatureChangeStarts([20, 15, 10]), false);
});

test('a small change today does not stop a big change tomorrow', () => {
  assert.equal(temperatureChangeStarts([18, 15, 10]), true);
});

test('a change that reverses direction counts as a new change', () => {
  assert.equal(temperatureChangeStarts([20, 15, 25]), true);
  assert.equal(temperatureChangeStarts([12, 20, 12]), true);
});

test('a real forecast with a 4°C drop sends, even with the same icons all week', async () => {
  const { notifier, sent } = setup({
    fetchForecast: async () => forecast({ rainy: false, recentTempC: 12, tempC: 8 }),
  });
  await notifier.checkAll();
  assert.deepEqual(sent.map((m) => iconsIn(m.keyboard)), ['🧥-🧥-🧥-🧥']);
});

test('a real forecast with a smaller drop and the same icons stays quiet', async () => {
  const { notifier, sent } = setup({
    fetchForecast: async () => forecast({ rainy: false, recentTempC: 12, tempC: 9 }),
  });
  await notifier.checkAll();
  assert.equal(sent.length, 0);
});

test('a real forecast with a 4°C rise sends', async () => {
  const { notifier, sent } = setup({
    fetchForecast: async () => forecast({ rainy: false, recentTempC: 16, tempC: 20 }),
  });
  await notifier.checkAll();
  assert.deepEqual(sent.map((m) => iconsIn(m.keyboard)), ['🍃-🍃-🍃-🍃']);
});

test('a real forecast does not repeat a change that began today', async () => {
  const data = forecast({ rainy: false, recentTempC: 12, tempC: 8 });
  for (let i = TODAY_START; i < TOMORROW_START; i++) data.hourly.temperature_2m[i] = 8 + 4;
  for (let i = TODAY_START - 24; i < TODAY_START; i++) data.hourly.temperature_2m[i] = 16;
  const { notifier, sent } = setup({ fetchForecast: async () => data });
  await notifier.checkAll();
  assert.equal(sent.length, 0);
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

test('at 20:00 Japan time, a rainy tomorrow sends a day card', async () => {
  const { notifier, sent } = setup();
  await notifier.checkAll();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'u1');
  assert.equal(sent[0].text, '☔ · 🚫 · 🚫 · 🚫');
  assert.equal(iconsIn(sent[0].keyboard), '☔-🚫-🚫-🚫');
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
  assert.equal(iconsIn(sent[0].keyboard), '🧥-🧥-🧥-🧥');
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
    // A 1°C difference, so only the clothes rule can send a message here.
    const data = forecast({ rainy: false, tempC: 15, recentTempC: 16 });
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
  const store = createMemoryStore();
  store.setLocation('u1', { lat: 35.68, lon: 139.76, timezone: 'Asia/Tokyo' });
  let fail = true;
  const delivered = [];
  const notifier = createNotifier({
    messenger: {
      sendText: async (to, text) => {
        if (fail) throw new Error('send down');
        delivered.push(text);
        return { message_id: delivered.length };
      },
    },
    store,
    fetchForecast: async () => forecast(),
    now: () => new Date('2026-11-04T20:00:00+09:00').getTime(),
    log: { error() {} },
  });
  await notifier.checkAll();
  assert.equal((await store.getLocation('u1')).lastCheckedDate, undefined);
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

test('each run checks at most 3 users, and later runs reach the rest', async () => {
  const { notifier, sent } = setup({ users: ['a', 'b', 'c', 'd', 'e'] });
  await notifier.checkAll();
  assert.deepEqual(sent.map((m) => m.to), ['a', 'b', 'c']);
  await notifier.checkAll();
  assert.deepEqual(sent.map((m) => m.to), ['a', 'b', 'c', 'd', 'e']);
  await notifier.checkAll();
  assert.equal(sent.length, 5);
});

test('users already checked today do not use up a run', async () => {
  const { notifier, sent, store } = setup({ users: ['a', 'b', 'c', 'd'] });
  await store.markChecked('a', '2026-11-04');
  await store.markChecked('b', '2026-11-04');
  await notifier.checkAll();
  assert.deepEqual(sent.map((m) => m.to), ['c', 'd']);
});

test('users in a timezone before 20:00 do not use up a run', async () => {
  const { notifier, sent, store, state } = setup({ users: [] });
  for (const id of ['in1', 'in2', 'in3']) await store.setLocation(id, { lat: 28.61, lon: 77.21, timezone: 'Asia/Kolkata' });
  await store.setLocation('tokyo', { lat: 35.68, lon: 139.76, timezone: 'Asia/Tokyo' });
  state.time = '2026-11-04T11:00:00Z'; // 20:00 in Tokyo, 16:30 in India.
  await notifier.checkAll();
  assert.deepEqual(sent.map((m) => m.to), ['tokyo']);
});
