import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayOutlook } from '../src/outlook.js';

const slots = (count) =>
  Array.from({ length: count }, (_, hour) => ({
    hour,
    tempC: 20,
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

const RAIN = { precipMm: 3, precipProb: 90 };

test('a mild dry day has four empty slots and nothing to report', () => {
  assert.deepEqual(dayOutlook(day()), { icons: '🚫-🚫-🚫-🚫', umbrella: false, weather: [] });
});

test('parts split at 12:00 and 18:00, and night is the last icon', () => {
  assert.equal(dayOutlook(day({ 11: RAIN })).icons, '☔-🚫-🚫-🚫');
  assert.equal(dayOutlook(day({ 12: RAIN })).icons, '🚫-☔-🚫-🚫');
  assert.equal(dayOutlook(day({ 18: RAIN })).icons, '🚫-🚫-☔-🚫');
  assert.equal(dayOutlook(day({}, { 5: RAIN })).icons, '🚫-🚫-🚫-☔');
});

test('2 mm or more in a part means an umbrella, whatever the chance', () => {
  const outlook = dayOutlook(day({ 13: { precipMm: 2, precipProb: 10 } }));
  assert.equal(outlook.icons, '🚫-☔-🚫-🚫');
  assert.equal(outlook.umbrella, true);
});

test('rain adds up across the hours of a part, but not across parts', () => {
  const sameAfternoon = { 13: { precipMm: 1 }, 14: { precipMm: 1 } };
  assert.equal(dayOutlook(day(sameAfternoon)).icons, '🚫-☔-🚫-🚫');
  const twoParts = { 11: { precipMm: 1 }, 12: { precipMm: 1 } };
  assert.equal(dayOutlook(day(twoParts)).icons, '🌦️-🌦️-🚫-🚫');
});

test('a 70% chance needs 0.5 mm to mean an umbrella', () => {
  const certain = dayOutlook(day({ 13: { precipMm: 0.5, precipProb: 70 } }));
  assert.equal(certain.icons, '🚫-☔-🚫-🚫');
  assert.equal(certain.umbrella, true);

  const tooLittleRain = dayOutlook(day({ 13: { precipMm: 0.4, precipProb: 95 } }));
  assert.equal(tooLittleRain.icons, '🚫-🌦️-🚫-🚫');
  assert.equal(tooLittleRain.umbrella, false);

  const tooUnlikely = dayOutlook(day({ 13: { precipMm: 1.9, precipProb: 69 } }));
  assert.equal(tooUnlikely.icons, '🚫-🌦️-🚫-🚫');
  assert.equal(tooUnlikely.umbrella, false);
});

test('light rain needs a 50% chance or 1 mm, and does not mean an umbrella', () => {
  assert.equal(dayOutlook(day({ 13: { precipProb: 49 } })).icons, '🚫-🚫-🚫-🚫');
  assert.equal(dayOutlook(day({ 13: { precipMm: 0.9, precipProb: 30 } })).icons, '🚫-🚫-🚫-🚫');
  for (const change of [{ precipProb: 50 }, { precipMm: 1, precipProb: 30 }]) {
    const outlook = dayOutlook(day({ 13: change }));
    assert.equal(outlook.icons, '🚫-🌦️-🚫-🚫');
    assert.equal(outlook.umbrella, false);
  }
});

test('both rain levels can appear in the same day', () => {
  const outlook = dayOutlook(day({ 8: { precipProb: 55 }, 14: RAIN }));
  assert.equal(outlook.icons, '🌦️-☔-🚫-🚫');
  assert.equal(outlook.umbrella, true);
});

test('night rain shows an icon but does not count as a reason to message', () => {
  const outlook = dayOutlook(day({}, { 2: { precipMm: 6, precipProb: 90 } }));
  assert.equal(outlook.icons, '🚫-🚫-🚫-☔');
  assert.equal(outlook.umbrella, false);
});

test('hours before 06:00 of the day itself are ignored', () => {
  assert.equal(dayOutlook(day({ 3: { precipMm: 5, precipProb: 100 } })).icons, '🚫-🚫-🚫-🚫');
});

test('cold shows a jacket at 15°C and below', () => {
  assert.equal(dayOutlook(day({ 8: { tempC: 15.1 } })).icons, '🚫-🚫-🚫-🚫');
  const outlook = dayOutlook(day({ 8: { tempC: 15 } }));
  assert.equal(outlook.icons, '🧥-🚫-🚫-🚫');
  assert.deepEqual(outlook.weather, ['cold']);
});

test('very cold shows a snowflake below 5°C, instead of a jacket', () => {
  const outlook = dayOutlook(day({ 8: { tempC: 4.9 }, 14: { tempC: 5 } }));
  assert.equal(outlook.icons, '❄️-🧥-🚫-🚫');
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
  assert.equal(dayOutlook(day({ 8: { tempC: 5, ...RAIN } })).icons, '☔🧥-🚫-🚫-🚫');
  assert.equal(dayOutlook(day({ 8: { tempC: 5, precipProb: 55 } })).icons, '🌦️🧥-🚫-🚫-🚫');
});

test('night cold shows an icon but does not count as a reason to message', () => {
  const outlook = dayOutlook(day({}, { 3: { tempC: -2 } }));
  assert.equal(outlook.icons, '🚫-🚫-🚫-❄️');
  assert.deepEqual(outlook.weather, []);
});

test('snow does not trigger either rain icon, but the cold still shows', () => {
  const outlook = dayOutlook(day({ 13: { tempC: -1, precipMm: 4, precipProb: 90, code: 73 } }));
  assert.equal(outlook.icons, '🚫-❄️-🚫-🚫');
  assert.equal(outlook.umbrella, false);
});
