import { DAY_PARTS, isSnow } from './summary.js';

const MIN_RAIN_PROBABILITY = 50;
const MIN_RAIN_MM = 1;
const COLD_C = 10;
const VERY_COLD_C = 0;
const HOT_C = 30;
const CLEAR_SKY_MAX_CODE = 1; // WMO: 0 is clear, 1 is mainly clear.

const RAIN_ICON = '☔';
const NOTHING_ICON = '🚫';
const WEATHER_ICONS = { cold: '🧣', veryCold: '🧥', hot: '☀️' };

function describePart({ hours, daylight }) {
  const rainHours = hours.filter((h) => !isSnow(h.code));
  const rainMm = rainHours.reduce((total, h) => total + h.precipMm, 0);
  const rain = rainMm >= MIN_RAIN_MM || rainHours.some((h) => h.precipProb >= MIN_RAIN_PROBABILITY);

  const coldest = Math.min(...hours.map((h) => h.tempC));
  let weather = null;
  if (coldest <= VERY_COLD_C) weather = 'veryCold';
  else if (coldest <= COLD_C) weather = 'cold';
  else if (daylight && hours.some((h) => h.tempC >= HOT_C && h.code <= CLEAR_SKY_MAX_CODE)) weather = 'hot';

  const icon = `${rain ? RAIN_ICON : ''}${WEATHER_ICONS[weather] ?? ''}` || NOTHING_ICON;
  return { rain, weather, icon };
}

/**
 * Describes a day in four parts: morning, afternoon, evening, then the night that
 * follows (00:00–06:00 of the next date). `icons` shows all four, but `rain` and
 * `weather` cover only the waking parts, because night weather alone shouldn't be
 * a reason to message anyone.
 */
export function dayOutlook(day) {
  const waking = DAY_PARTS.map(({ from, to }) => ({
    hours: day.hours.slice(from, to),
    daylight: to <= 18,
  })).map(describePart);
  const night = describePart({ hours: day.nextNight, daylight: false });

  return {
    icons: [...waking, night].map((part) => part.icon).join('-'),
    rain: waking.some((part) => part.rain),
    weather: [...new Set(waking.map((part) => part.weather).filter(Boolean))],
  };
}
