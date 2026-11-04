import { dayOutlook, wakingAverageC } from './outlook.js';
import { getDay } from './weather.js';

export const NOTIFY_HOUR = 20;
const NORMAL_WEATHER_DAYS = 7;
const TEMPERATURE_CHANGE_C = 4;

// Each user takes up to 3 outgoing requests: forecast, message and saving the date.
// With the 1 request that loads users, 3 users fit Cloudflare's limit of 10 per run.
const MAX_USERS_PER_RUN = 3;

// Very cold clothes also cover a merely cold day, but not the other way round.
const COVERED_BY = { cold: ['cold', 'veryCold'], veryCold: ['veryCold'], hot: ['hot'] };

// Creating a formatter is slow compared with Cloudflare's CPU limit, so reuse them.
const formatters = new Map();

function formatterFor(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23',
      }),
    );
  }
  return formatters.get(timeZone);
}

function localTime(nowMs, timeZone) {
  const parts = formatterFor(timeZone).formatToParts(nowMs);
  const part = (type) => parts.find((p) => p.type === type).value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) };
}

/**
 * Checks whether tomorrow starts a temperature change, compared with the 7 days before
 * it. Takes daily averages from 7 days ago up to tomorrow. A change that already began
 * today doesn't count again, so a cold spell gets one message rather than one a day.
 */
export function temperatureChangeStarts(averages) {
  const changeOn = (i) => {
    const previousWeek = averages.slice(i - NORMAL_WEATHER_DAYS, i);
    return averages[i] - previousWeek.reduce((a, b) => a + b, 0) / previousWeek.length;
  };
  const tomorrow = changeOn(averages.length - 1);
  const today = changeOn(averages.length - 2);
  if (Math.abs(tomorrow) < TEMPERATURE_CHANGE_C) return false;
  return Math.abs(today) < TEMPERATURE_CHANGE_C || Math.sign(today) !== Math.sign(tomorrow);
}

/**
 * Decides whether an outlook is worth a message. Needing an umbrella always is,
 * however many days it lasts. Light rain alone isn't. Otherwise it needs a temperature
 * change, or cold or hot weather calling for different clothes than recent days did,
 * so a jacket in the middle of winter isn't news.
 */
export function shouldSend(outlook, recentOutlooks, temperatureChanged = false) {
  if (outlook.umbrella || temperatureChanged) return true;
  const recentWeather = new Set(recentOutlooks.flatMap((recent) => recent.weather));
  return outlook.weather.some((kind) => !COVERED_BY[kind].some((covering) => recentWeather.has(covering)));
}

/**
 * Tells users the evening before if tomorrow is worth a message. Runs on a schedule
 * and handles a few users each time. Anyone not reached, or whose check failed, is
 * picked up by a later run before their midnight, and each user's saved date stops
 * the message being sent twice.
 */
export function createNotifier({ messenger, store, fetchForecast, keyboard, now = Date.now, log = console }) {
  async function checkUser(userId, user, date) {
    const forecast = await fetchForecast(user.lat, user.lon);
    const outlook = dayOutlook(getDay(forecast, 1));
    const recent = Array.from({ length: NORMAL_WEATHER_DAYS }, (_, i) => dayOutlook(getDay(forecast, -i)));
    const averages = Array.from({ length: NORMAL_WEATHER_DAYS + 2 }, (_, i) =>
      wakingAverageC(getDay(forecast, i - NORMAL_WEATHER_DAYS)),
    );
    if (shouldSend(outlook, recent, temperatureChangeStarts(averages))) {
      await messenger.sendText(userId, outlook.icons, keyboard);
    }
    await store.markChecked(userId, date);
  }

  return {
    async checkAll() {
      let checked = 0;
      for (const [userId, user] of await store.getUsers()) {
        const { date, hour } = localTime(now(), user.timezone);
        if (hour < NOTIFY_HOUR || user.lastCheckedDate === date) continue;
        if (checked === MAX_USERS_PER_RUN) break;
        checked++;
        try {
          await checkUser(userId, user, date);
        } catch (err) {
          log.error('Daily check failed:', err.message);
        }
      }
    },
  };
}
