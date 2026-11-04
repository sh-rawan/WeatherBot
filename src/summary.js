const MIN_WET_MM = 0.1;
const MIN_WET_PROBABILITY = 50;
const LIGHT_RAIN_MAX_MM = 2.5;
const MODERATE_RAIN_MAX_MM = 7.6;
const STRONG_GUST_KMH = 50;

export const DAY_PARTS = [
  { name: 'Morning', from: 6, to: 12 },
  { name: 'Afternoon', from: 12, to: 18 },
  { name: 'Evening', from: 18, to: 24 },
];

// WMO weather codes.
export const isSnow = (code) => (code >= 71 && code <= 77) || code === 85 || code === 86;
const isThunder = (code) => code >= 95;

const isWet = (h) =>
  !isSnow(h.code) && (h.precipMm >= MIN_WET_MM || h.precipProb >= MIN_WET_PROBABILITY);

const sum = (values) => values.reduce((a, b) => a + b, 0);
const pad = (n) => String(n).padStart(2, '0');
const clock = (hour) => (hour === 24 ? 'midnight' : `${pad(hour)}:00`);

function rainWindows(hours) {
  const windows = [];
  for (const h of hours) {
    if (!isWet(h)) continue;
    const current = windows.at(-1);
    if (current && current.at(-1).hour === h.hour - 1) current.push(h);
    else windows.push([h]);
  }
  return windows;
}

function describeWindow(hours) {
  const peakMm = Math.max(...hours.map((h) => h.precipMm));
  const totalMm = sum(hours.map((h) => h.precipMm));
  const chance = Math.max(...hours.map((h) => h.precipProb));
  const span = `${clock(hours[0].hour)}–${clock(hours.at(-1).hour + 1)}`;
  const chanceText = chance > 0 ? ` (up to ${chance}% chance)` : '';

  if (peakMm < MIN_WET_MM) return `${span}: rain possible${chanceText}`;
  const intensity =
    peakMm < LIGHT_RAIN_MAX_MM ? 'light' : peakMm < MODERATE_RAIN_MAX_MM ? 'moderate' : 'heavy';
  return `${span}: ${intensity} rain, ~${totalMm.toFixed(1)} mm${chanceText}`;
}

function describePart(name, hours) {
  const wet = hours.filter(isWet).length;
  const state = wet === 0 ? 'no rain' : wet <= 2 ? 'some rain' : wet < hours.length ? 'rain on and off' : 'rainy';
  const temp = Math.round(sum(hours.map((h) => h.tempC)) / hours.length);
  return `${name}: ${state}, around ${temp}°C`;
}

function headline(wetHours, thunder) {
  if (thunder) return '⛈️ Thunderstorms likely';
  if (wetHours === 0) return '🌤️ No rain expected';
  if (wetHours <= 3) return '🌦️ A few showers';
  if (wetHours <= 8) return '🌧️ Rainy spells';
  return '🌧️ A rainy day';
}

function advice(wetHourList) {
  if (wetHourList.length === 0) return 'No umbrella needed.';
  const peakMm = Math.max(...wetHourList.map((h) => h.precipMm));
  const peakGust = Math.max(...wetHourList.map((h) => h.gustKmh));
  const tips = [
    peakGust >= STRONG_GUST_KMH
      ? `Wear a raincoat: gusts reach ${Math.round(peakGust)} km/h, too strong for an umbrella.`
      : 'Take an umbrella.',
  ];
  if (peakMm >= MODERATE_RAIN_MAX_MM) tips.push('Wear waterproof shoes and allow extra travel time.');
  return tips.join(' ');
}

function formatDate(date) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function summarizeDay({ date, hours }, label) {
  const temps = hours.map((h) => h.tempC);
  const wet = hours.filter(isWet);
  const thunder = hours.some((h) => isThunder(h.code));
  const snow = hours.some((h) => isSnow(h.code));

  const lines = [
    `*${label}, ${formatDate(date)}*`,
    headline(wet.length, thunder),
    `🌡️ ${Math.round(Math.min(...temps))}° to ${Math.round(Math.max(...temps))}°C`,
  ];

  if (wet.length > 0) {
    lines.push('', '☔ When it rains:');
    for (const window of rainWindows(hours)) lines.push(`• ${describeWindow(window)}`);
  }

  lines.push('', ...DAY_PARTS.map(({ name, from, to }) => describePart(name, hours.slice(from, to))));

  if (snow) {
    lines.push('', '❄️ Snow is also forecast. I only cover rain so far, so check a full forecast.');
  }
  if (wet.length > 0 || !snow) {
    lines.push('', `💡 ${advice(wet)}`);
  }
  return lines.join('\n');
}
