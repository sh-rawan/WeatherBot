import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayOutlook } from '../src/outlook.js';

const slots = (count) =>
  Array.from({ length: count }, (_, hour) => ({
    hour,
    tempC: 15,
    precipMm: 0,
    precipProb: 0,
    code: 3,
    gustKmh: 5,
  }));

const day = (changes = {}, nightChanges = {}) => {
  const hours = slots(24);
  const nextNight = slots(6);
  for (const [hour, change] of Object.entries(changes)) Object.assign(hours[hour], change);
  for (const [hour, change] of Object.entries(nightChanges)) Object.assign(nextNight[hour], change);
  return { date: '2026-11-05', hours, nextNight };
};

test('a mild dry day has four empty slots and nothing to report', () => {
  assert.deepEqual(dayOutlook(day()), { icons: '🚫-🚫-🚫-🚫', rain: false, weather: [] });
});

test('parts split at 12:00 and 18:00, and night is the last icon', () => {
  const rain = { precipProb: 60 };
  assert.equal(dayOutlook(day({ 11: rain })).icons, '☔-🚫-🚫-🚫');
  assert.equal(dayOutlook(day({ 12: rain })).icons, '🚫-☔-🚫-🚫');
  assert.equal(dayOutlook(day({ 18: rain })).icons, '🚫-🚫-☔-🚫');
  assert.equal(dayOutlook(day({}, { 5: rain })).icons, '🚫-🚫-🚫-☔');
});

test('night rain shows an icon but does not count as a reason to message', () => {
  const outlook = dayOutlook(day({}, { 2: { precipMm: 6, precipProb: 90 } }));
  assert.equal(outlook.icons, '🚫-🚫-🚫-☔');
  assert.equal(outlook.rain, false);
});

test('hours before 06:00 of the day itself are ignored', () => {
  assert.equal(dayOutlook(day({ 3: { precipMm: 5, precipProb: 100 } })).icons, '🚫-🚫-🚫-🚫');
});

test('rain needs a 50% chance or 1 mm in total', () => {
  assert.equal(dayOutlook(day({ 13: { precipProb: 49 } })).rain, false);
  assert.equal(dayOutlook(day({ 13: { precipProb: 50 } })).rain, true);
  assert.equal(dayOutlook(day({ 13: { precipMm: 0.9, precipProb: 30 } })).rain, false);
  const twoHours = { 13: { precipMm: 0.5, precipProb: 30 }, 14: { precipMm: 0.5, precipProb: 30 } };
  assert.equal(dayOutlook(day(twoHours)).rain, true);
});

test('cold shows a muffler at 10°C and below', () => {
  assert.equal(dayOutlook(day({ 8: { tempC: 10.1 } })).icons, '🚫-🚫-🚫-🚫');
  const outlook = dayOutlook(day({ 8: { tempC: 10 } }));
  assert.equal(outlook.icons, '🧣-🚫-🚫-🚫');
  assert.deepEqual(outlook.weather, ['cold']);
});

test('very cold shows a coat at 0°C and below, instead of a muffler', () => {
  const outlook = dayOutlook(day({ 8: { tempC: 0 }, 14: { tempC: 5 } }));
  assert.equal(outlook.icons, '🧥-🧣-🚫-🚫');
  assert.deepEqual(outlook.weather, ['veryCold', 'cold']);
});

test('sun needs both heat and a clear sky', () => {
  assert.equal(dayOutlook(day({ 13: { tempC: 30, code: 1 } })).icons, '🚫-☀️-🚫-🚫');
  assert.equal(dayOutlook(day({ 13: { tempC: 30, code: 3 } })).icons, '🚫-🚫-🚫-🚫');
  assert.equal(dayOutlook(day({ 13: { tempC: 29, code: 0 } })).icons, '🚫-🚫-🚫-🚫');
});

test('no sun icon after dark, however warm it is', () => {
  const outlook = dayOutlook(day({ 20: { tempC: 31, code: 0 } }, { 1: { tempC: 31, code: 0 } }));
  assert.equal(outlook.icons, '🚫-🚫-🚫-🚫');
});

test('rain and cold in the same part show both icons', () => {
  assert.equal(dayOutlook(day({ 8: { tempC: 5, precipProb: 80 } })).icons, '☔🧣-🚫-🚫-🚫');
});

test('night cold shows an icon but does not count as a reason to message', () => {
  const outlook = dayOutlook(day({}, { 3: { tempC: -2 } }));
  assert.equal(outlook.icons, '🚫-🚫-🚫-🧥');
  assert.deepEqual(outlook.weather, []);
});

test('snow does not trigger an umbrella, but the cold still shows', () => {
  const outlook = dayOutlook(day({ 13: { tempC: -1, precipMm: 4, precipProb: 90, code: 73 } }));
  assert.equal(outlook.icons, '🚫-🧥-🚫-🚫');
  assert.equal(outlook.rain, false);
});
