const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const PAST_DAYS = 7;

export async function fetchForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: 'temperature_2m,apparent_temperature,precipitation,precipitation_probability,weather_code,wind_gusts_10m',
    timezone: 'auto',
    // One day more than we show: the last hour of a day is reported at 00:00 of the next.
    forecast_days: '3',
    past_days: PAST_DAYS,
  });
  const res = await fetch(`${FORECAST_URL}?${params}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Open-Meteo responded ${res.status}`);
  return { ...(await res.json()), pastDays: PAST_DAYS };
}

/**
 * Open-Meteo resolves the timezone from the coordinates. These timezones cover each
 * country including remote islands, and exclude close neighbours such as Busan or
 * Singapore. Japan: Tokyo. Malaysia: Kuala Lumpur, Kuching. India: Kolkata, or its
 * older name Calcutta.
 */
const COVERED_TIMEZONES = new Set([
  'Asia/Tokyo',
  'Asia/Kuala_Lumpur',
  'Asia/Kuching',
  'Asia/Kolkata',
  'Asia/Calcutta',
]);

export const isCoveredLocation = (forecast) => COVERED_TIMEZONES.has(forecast.timezone);

/**
 * Picks one local calendar day (0 = today, 1 = tomorrow, -1 = yesterday) as 24 hourly slots,
 * where slot `hour` describes the period from hour:00 to hour+1:00. `nextNight`
 * holds the same slots for 00:00–06:00 of the following date.
 *
 * Open-Meteo reports temperature at the instant of the timestamp, but
 * precipitation, its probability and gusts for the hour BEFORE the timestamp.
 * Those values are therefore read one index later, otherwise rain would be
 * shown an hour late.
 */
export function getDay(forecast, dayOffset) {
  const { time, temperature_2m, apparent_temperature, precipitation, precipitation_probability, weather_code, wind_gusts_10m } =
    forecast.hourly;
  const start = ((forecast.pastDays ?? 0) + dayOffset) * 24;
  const slot = (instant, hour) => {
    const period = instant + 1;
    return {
      hour,
      tempC: temperature_2m[instant],
      feelsC: apparent_temperature?.[instant] ?? temperature_2m[instant],
      precipMm: precipitation[period] ?? 0,
      precipProb: precipitation_probability[period] ?? 0,
      code: weather_code[period],
      gustKmh: wind_gusts_10m[period] ?? 0,
    };
  };
  const slots = (first, count) => Array.from({ length: count }, (_, hour) => slot(first + hour, hour));
  return {
    date: time[start].slice(0, 10),
    hours: slots(start, 24),
    nextNight: slots(start + 24, 6),
  };
}
