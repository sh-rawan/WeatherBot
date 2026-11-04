import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getDay } from '../src/weather.js';

const hourlyData = (size, firstDay) => ({
  time: Array.from({ length: size }, (_, i) => `2026-11-0${firstDay + Math.floor(i / 24)}T00:00`),
  temperature_2m: Array.from({ length: size }, (_, i) => i),
  precipitation: Array(size).fill(0),
  precipitation_probability: Array(size).fill(0),
  weather_code: Array(size).fill(0),
  wind_gusts_10m: Array(size).fill(0),
});

test('getDay reads rain from the following timestamp, which reports the preceding hour', () => {
  const hourly = hourlyData(72, 4);
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

test('nextNight holds 00:00 to 06:00 of the following date', () => {
  const hourly = hourlyData(72, 4);
  hourly.precipitation[24 + 3] = 4; // Timestamp 03:00 tomorrow means rain from 02:00 to 03:00.

  const { nextNight } = getDay({ hourly }, 0);
  assert.equal(nextNight.length, 6);
  assert.equal(nextNight[2].precipMm, 4);
  assert.equal(nextNight[0].tempC, 24);
});

test('getDay counts days from today when past days are included', () => {
  const forecast = { hourly: hourlyData(96, 3), pastDays: 1 };
  assert.equal(getDay(forecast, -1).date, '2026-11-03');
  assert.equal(getDay(forecast, 0).date, '2026-11-04');
  assert.equal(getDay(forecast, 1).date, '2026-11-05');
});
