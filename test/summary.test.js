import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeDay } from '../src/summary.js';
import { getDay } from '../src/weather.js';

const dryHours = () =>
  Array.from({ length: 24 }, (_, hour) => ({
    hour,
    tempC: 10 + hour / 2,
    precipMm: 0,
    precipProb: 0,
    code: 1,
    gustKmh: 10,
  }));

const withHours = (changes) => {
  const hours = dryHours();
  for (const [hour, change] of Object.entries(changes)) Object.assign(hours[hour], change);
  return { date: '2026-11-05', hours };
};

test('getDay reads rain from the following timestamp, which reports the preceding hour', () => {
  const size = 72;
  const hourly = {
    time: Array.from({ length: size }, (_, i) => `2026-11-0${4 + Math.floor(i / 24)}T00:00`),
    temperature_2m: Array.from({ length: size }, (_, i) => i),
    precipitation: Array(size).fill(0),
    precipitation_probability: Array(size).fill(0),
    weather_code: Array(size).fill(0),
    wind_gusts_10m: Array(size).fill(0),
  };
  hourly.precipitation[15] = 2; // Timestamp 15:00 today means rain from 14:00 to 15:00.
  hourly.precipitation[24] = 3; // Timestamp 00:00 tomorrow means rain in today's last hour.

  const today = getDay({ hourly }, 0);
  assert.equal(today.date, '2026-11-04');
  assert.equal(today.hours[14].precipMm, 2);
  assert.equal(today.hours[14].tempC, 14);
  assert.equal(today.hours[23].precipMm, 3);
  assert.equal(today.hours[15].precipMm, 0);
  assert.equal(getDay({ hourly }, 1).date, '2026-11-05');
});

test('getDay counts days from today when past days are included', () => {
  const size = 96;
  const hourly = {
    time: Array.from({ length: size }, (_, i) => `2026-11-0${3 + Math.floor(i / 24)}T00:00`),
    temperature_2m: Array(size).fill(0),
    precipitation: Array(size).fill(0),
    precipitation_probability: Array(size).fill(0),
    weather_code: Array(size).fill(0),
    wind_gusts_10m: Array(size).fill(0),
  };
  const forecast = { hourly, pastDays: 1 };
  assert.equal(getDay(forecast, -1).date, '2026-11-03');
  assert.equal(getDay(forecast, 0).date, '2026-11-04');
  assert.equal(getDay(forecast, 1).date, '2026-11-05');
});

test('dry day says no umbrella and lists no rain', () => {
  const text = summarizeDay(withHours({}), 'Tomorrow');
  assert.match(text, /Tomorrow, Thu 5 Nov/);
  assert.match(text, /No rain expected/);
  assert.match(text, /No umbrella needed/);
  assert.doesNotMatch(text, /When it rains/);
});

test('consecutive wet hours merge into one window, separate ones stay apart', () => {
  const text = summarizeDay(
    withHours({
      8: { precipMm: 1, precipProb: 60 },
      9: { precipMm: 2, precipProb: 80 },
      20: { precipMm: 0, precipProb: 55 },
    }),
    'Today',
  );
  assert.match(text, /A few showers/);
  assert.match(text, /08:00–10:00: light rain, ~3\.0 mm \(up to 80% chance\)/);
  assert.match(text, /20:00–21:00: rain possible \(up to 55% chance\)/);
  assert.match(text, /Take an umbrella/);
});

test('rain in the last hour of the day ends at midnight', () => {
  const text = summarizeDay(withHours({ 23: { precipMm: 1, precipProb: 90 } }), 'Today');
  assert.match(text, /23:00–midnight/);
});

test('heavy rain and strong gusts change the advice', () => {
  const text = summarizeDay(withHours({ 14: { precipMm: 9, precipProb: 90, gustKmh: 62 } }), 'Today');
  assert.match(text, /heavy rain/);
  assert.match(text, /raincoat: gusts reach 62 km\/h/);
  assert.match(text, /waterproof shoes/);
});

test('all-day rain is called a rainy day', () => {
  const changes = Object.fromEntries(dryHours().map((h) => [h.hour, { precipMm: 1, precipProb: 90 }]));
  const text = summarizeDay(withHours(changes), 'Today');
  assert.match(text, /A rainy day/);
  assert.match(text, /00:00–midnight/);
  assert.match(text, /Afternoon: rainy/);
});

test('snow is not reported as rain and gets no umbrella advice', () => {
  const text = summarizeDay(withHours({ 10: { precipMm: 2, precipProb: 90, code: 73 } }), 'Today');
  assert.match(text, /No rain expected/);
  assert.match(text, /Snow is also forecast/);
  assert.doesNotMatch(text, /No umbrella needed/);
});

test('thunderstorms take over the headline', () => {
  const text = summarizeDay(withHours({ 16: { precipMm: 5, precipProb: 90, code: 95 } }), 'Today');
  assert.match(text, /Thunderstorms likely/);
});
