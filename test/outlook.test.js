import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayOutlook } from '../src/outlook.js';

const slots = (count) =>
  Array.from({ length: count }, (_, hour) => ({
    hour,
    tempC: 25,
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

test('a warm dry day has four empty slots and nothing to report', () => {
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

test('a 70% chance needs 1 mm to mean an umbrella', () => {
  const certain = dayOutlook(day({ 13: { precipMm: 1, precipProb: 70 } }));
  assert.equal(certain.icons, '🚫-☔-🚫-🚫');
  assert.equal(certain.umbrella, true);

  const tooLittleRain = dayOutlook(day({ 13: { precipMm: 0.9, precipProb: 95 } }));
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
  assert.equal(dayOutlook(day({ 3: { precipMm: 5, precipProb: 100, tempC: -5 } })).icons, '🚫-🚫-🚫-🚫');
});

test('mildly cold shows a leaf at 23°C and below', () => {
  assert.equal(dayOutlook(day({ 8: { tempC: 23.1 } })).icons, '🚫-🚫-🚫-🚫');
  const outlook = dayOutlook(day({ 8: { tempC: 23 } }));
  assert.equal(outlook.icons, '🍃-🚫-🚫-🚫');
  assert.deepEqual(outlook.weather, ['cool']);
});

test('very cold shows a jacket at 15°C and below', () => {
  assert.equal(dayOutlook(day({ 8: { tempC: 15.1 } })).icons, '🍃-🚫-🚫-🚫');
  const outlook = dayOutlook(day({ 8: { tempC: 15 } }));
  assert.equal(outlook.icons, '🧥-🚫-🚫-🚫');
  assert.deepEqual(outlook.weather, ['cold']);
});

test('freezing shows a snowflake below 5°C', () => {
  assert.equal(dayOutlook(day({ 8: { tempC: 5 } })).icons, '🧥-🚫-🚫-🚫');
  const outlook = dayOutlook(day({ 8: { tempC: 4.9 }, 14: { tempC: 5 }, 20: { tempC: 20 } }));
  assert.equal(outlook.icons, '❄️-🧥-🍃-🚫');
  assert.deepEqual(outlook.weather, ['veryCold', 'cold', 'cool']);
});

test('a clear sky at 25°C or more shows the sun, but is not worth a message', () => {
  const sunny = dayOutlook(day({ 13: { tempC: 25, code: 1 } }));
  assert.equal(sunny.icons, '🚫-☀️-🚫-🚫');
  assert.deepEqual(sunny.weather, []);
  assert.equal(dayOutlook(day({ 13: { tempC: 24.9, code: 0 } })).icons, '🚫-🚫-🚫-🚫');
  assert.equal(dayOutlook(day({ 13: { tempC: 30, code: 2 } })).icons, '🚫-🚫-🚫-🚫');
});

test('feeling like 35°C or more shows the sun under any sky, and is worth a message', () => {
  const sweaty = dayOutlook(day({ 13: { feelsC: 35, code: 3 } }));
  assert.equal(sweaty.icons, '🚫-☀️-🚫-🚫');
  assert.deepEqual(sweaty.weather, ['hot']);
  assert.equal(dayOutlook(day({ 13: { feelsC: 34.9, code: 3 } })).icons, '🚫-🚫-🚫-🚫');
});

test('sweaty and sunny together still show one sun', () => {
  assert.equal(dayOutlook(day({ 13: { tempC: 33, feelsC: 40, code: 0 } })).icons, '🚫-☀️-🚫-🚫');
});

test('no sun icon after dark, however warm it is', () => {
  const hot = { tempC: 31, feelsC: 40, code: 0 };
  const outlook = dayOutlook(day({ 20: hot }, { 1: hot }));
  assert.equal(outlook.icons, '🚫-🚫-🚫-🚫');
  assert.deepEqual(outlook.weather, []);
});

test('a cool start to a hot morning shows both icons', () => {
  const outlook = dayOutlook(day({ 6: { tempC: 22 }, 11: { tempC: 31, feelsC: 36, code: 0 } }));
  assert.equal(outlook.icons, '🍃☀️-🚫-🚫-🚫');
  assert.deepEqual(outlook.weather, ['cool', 'hot']);
});

test('rain and sun in the same part show both icons', () => {
  assert.equal(dayOutlook(day({ 13: { tempC: 26, code: 0 }, 14: RAIN })).icons, '🚫-☔☀️-🚫-🚫');
});

test('rain and cold in the same part show both icons', () => {
  assert.equal(dayOutlook(day({ 8: { tempC: 10, ...RAIN } })).icons, '☔🧥-🚫-🚫-🚫');
  assert.equal(dayOutlook(day({ 8: { tempC: 20, precipProb: 55 } })).icons, '🌦️🍃-🚫-🚫-🚫');
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
