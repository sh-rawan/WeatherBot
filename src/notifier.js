import { buildSuggestion } from './feedback.js';
import { dayCard, dayOutlook, wakingAverageC } from './outlook.js';
import { getDay } from './weather.js';

export const NOTIFY_HOUR = 20;
const NORMAL_WEATHER_DAYS = 7;
const TEMPERATURE_CHANGE_C = 4;

// Each user takes up to 3 outgoing requests: forecast, message and saving the results.
// With the 1 request that loads users, 3 users fit Cloudflare's limit of 10 per run.
const MAX_USERS_PER_RUN = 3;

// Warmer clothes also cover a milder day, but not the other way round.
const COVERED_BY = {
  cool: ['cool', 'cold', 'veryCold'],
  cold: ['cold', 'veryCold'],
  veryCold: ['veryCold'],
  hot: ['hot'],
};

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
 * Checks whether tomorrow starts a temperature change compared with today, using
 * daily averages for yesterday, today and tomorrow. A change continuing in the same
 * direction as today's doesn't count again, so a falling spell gets one message.
 */
export function temperatureChangeStarts([yesterday, today, tomorrow]) {
  const change = tomorrow - today;
  const previous = today - yesterday;
  if (Math.abs(change) < TEMPERATURE_CHANGE_C) return false;
  return Math.abs(previous) < TEMPERATURE_CHANGE_C || Math.sign(previous) !== Math.sign(change);
}

/**
 * Lists why an outlook is worth a message, if at all. Needing an umbrella always is,
 * however many days it lasts. Light rain alone isn't. Otherwise it needs a temperature
 * change, or cold or hot weather calling for different clothes than recent days did,
 * so a jacket in the middle of winter isn't news.
 */
export function sendReasons(outlook, recentOutlooks, temperatureChanged = false) {
  const recentWeather = new Set(recentOutlooks.flatMap((recent) => recent.weather));
  const newClothes = outlook.weather.some((kind) => !COVERED_BY[kind].some((covering) => recentWeather.has(covering)));
  return [
    ...(outlook.umbrella ? ['umbrella'] : []),
    ...(temperatureChanged ? ['temperature'] : []),
    ...(newClothes ? ['clothes'] : []),
  ];
}

export const shouldSend = (...args) => sendReasons(...args).length > 0;

/**
 * Tells users the evening before if tomorrow is worth a message. Runs on a schedule
 * and handles a few users each time. Anyone not reached, or whose check failed, is
 * picked up by a later run before their midnight, and each user's saved date stops
 * the message being sent twice.
 */
export function createNotifier({ messenger, store, fetchForecast, keyboard, now = Date.now, log = console }) {
  async function checkUser(userId, user, date) {
    const forecast = await fetchForecast(user.lat, user.lon);
    const tomorrow = getDay(forecast, 1);
    const outlook = dayOutlook(tomorrow);
    const recent = Array.from({ length: NORMAL_WEATHER_DAYS }, (_, i) => dayOutlook(getDay(forecast, -i)));
    const averages = [-1, 0, 1].map((offset) => wakingAverageC(getDay(forecast, offset)));
    const reasons = sendReasons(outlook, recent, temperatureChangeStarts(averages));

    if (reasons.length === 0) {
      await store.markChecked(userId, date);
      return;
    }
    const message = await messenger.sendText(userId, dayCard(tomorrow, 'Tomorrow'), keyboard);
    const suggestion = buildSuggestion({
      userId,
      messageId: message.message_id,
      source: 'evening',
      day: tomorrow,
      reasons,
      timezone: user.timezone,
      sentAt: new Date(now()).toISOString(),
      changeC: averages[2] - averages[1],
    });
    await store.logSuggestionAndMarkChecked(suggestion, userId, date);
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
