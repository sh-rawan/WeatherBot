export const DAY_PARTS = [
  { name: 'Morning', from: 6, to: 12 },
  { name: 'Afternoon', from: 12, to: 18 },
  { name: 'Evening', from: 18, to: 24 },
];

const UMBRELLA_TOTAL_MM = 2;
const UMBRELLA_PROBABILITY = 70;
const UMBRELLA_LIKELY_MM = 1;
const LIGHT_RAIN_TOTAL_MM = 1;
const LIGHT_RAIN_PROBABILITY = 50;

export const COOL_C = 23;
export const COLD_C = 15;
export const VERY_COLD_C = 5;
const SWEATY_FEELS_C = 35;
const SUNNY_C = 25;
const CLEAR_SKY_MAX_CODE = 1; // WMO: 0 is clear, 1 is mainly clear.

const PART_NAMES = ['Morning', 'Afternoon', 'Evening', 'Night'];

const NOTHING_ICON = '🚫';
const RAIN_ICONS = { umbrella: '☔', light: '🌦️' };
const COLD_ICONS = { cool: '🍃', cold: '🧥', veryCold: '❄️' };
const SUN_ICON = '☀️';

// WMO weather codes.
const isSnow = (code) => (code >= 71 && code <= 77) || code === 85 || code === 86;

/** Rates the rain in a part of the day: 'umbrella' (must carry), 'light', or null. */
function rainLevel(hours) {
  const rainHours = hours.filter((h) => !isSnow(h.code));
  const totalMm = rainHours.reduce((total, h) => total + h.precipMm, 0);
  const chance = Math.max(0, ...rainHours.map((h) => h.precipProb));
  if (totalMm >= UMBRELLA_TOTAL_MM || (chance >= UMBRELLA_PROBABILITY && totalMm >= UMBRELLA_LIKELY_MM)) {
    return 'umbrella';
  }
  if (totalMm >= LIGHT_RAIN_TOTAL_MM || chance >= LIGHT_RAIN_PROBABILITY) return 'light';
  return null;
}

function describePart({ hours, daylight }) {
  const rain = rainLevel(hours);

  const coldest = Math.min(...hours.map((h) => h.tempC));
  let cold = null;
  if (coldest < VERY_COLD_C) cold = 'veryCold';
  else if (coldest <= COLD_C) cold = 'cold';
  else if (coldest <= COOL_C) cold = 'cool';

  // The sun means sweaty or sunny. Only sweaty counts as weather worth a message.
  const sweaty = daylight && hours.some((h) => h.feelsC >= SWEATY_FEELS_C);
  const sunny = daylight && hours.some((h) => h.tempC >= SUNNY_C && h.code <= CLEAR_SKY_MAX_CODE);

  const icons = `${RAIN_ICONS[rain] ?? ''}${COLD_ICONS[cold] ?? ''}${sweaty || sunny ? SUN_ICON : ''}`;
  return {
    umbrella: rain === 'umbrella',
    weather: [cold, sweaty && 'hot'].filter(Boolean),
    icon: icons || NOTHING_ICON,
  };
}

/** The day's average temperature from 06:00 to midnight, when people are mostly awake. */
export function wakingAverageC(day) {
  const hours = day.hours.slice(DAY_PARTS[0].from);
  return hours.reduce((total, h) => total + h.tempC, 0) / hours.length;
}

/**
 * Describes a day in four parts: morning, afternoon, evening, then the night that
 * follows (00:00–06:00 of the next date). `icons` shows all four, but `umbrella` and
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
    umbrella: waking.some((part) => part.umbrella),
    weather: [...new Set(waking.flatMap((part) => part.weather))],
  };
}

function formatDate(date) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** The message for a day: a dated title, then one line per part of the day. */
export function dayCard(day, label) {
  const lines = dayOutlook(day)
    .icons.split('-')
    .map((icon, i) => `${icon}  ${PART_NAMES[i]}`);
  return `*${label} · ${formatDate(day.date)}*\n\n${lines.join('\n')}`;
}
