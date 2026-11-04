import { dayOutlook } from './outlook.js';
import { getDay } from './weather.js';

export const NOTIFY_HOUR = 20;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const JAPAN_UTC_OFFSET_MS = 9 * 60 * 60 * 1000; // Japan has no daylight saving time.
const NORMAL_WEATHER_DAYS = 7;

// Very cold clothes also cover a merely cold day, but not the other way round.
const COVERED_BY = { cold: ['cold', 'veryCold'], veryCold: ['veryCold'], hot: ['hot'] };

function japanTime(nowMs) {
  const iso = new Date(nowMs + JAPAN_UTC_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), hour: Number(iso.slice(11, 13)) };
}

/**
 * Decides whether an outlook is worth a message. Rain always is, however many days
 * it lasts. Cold or hot only is if it calls for different clothes than recent days
 * did, so a muffler in the middle of winter isn't news.
 */
export function shouldSend(outlook, recentOutlooks) {
  if (outlook.rain) return true;
  const recentWeather = new Set(recentOutlooks.flatMap((recent) => recent.weather));
  return outlook.weather.some((kind) => !COVERED_BY[kind].some((covering) => recentWeather.has(covering)));
}

/**
 * Tells each user the evening before if tomorrow is worth a message. Because the
 * check repeats until midnight, a restart or forecast outage at 20:00 only delays
 * the message, and each user's saved date stops it being sent twice.
 */
export function createNotifier({ messenger, store, fetchForecast, keyboard, now = Date.now, log = console }) {
  async function checkAll() {
    const { date, hour } = japanTime(now());
    if (hour < NOTIFY_HOUR) return;

    for (const [userId, user] of store.getUsers()) {
      if (user.lastCheckedDate === date) continue;
      try {
        const forecast = await fetchForecast(user.lat, user.lon);
        const outlook = dayOutlook(getDay(forecast, 1));
        const recent = Array.from({ length: NORMAL_WEATHER_DAYS }, (_, i) => dayOutlook(getDay(forecast, -i)));
        if (shouldSend(outlook, recent)) await messenger.sendText(userId, outlook.icons, keyboard);
        store.updateUser(userId, { lastCheckedDate: date });
      } catch (err) {
        log.error('Daily check failed:', err.message);
      }
    }
  }

  return {
    checkAll,
    start() {
      const run = async () => {
        await checkAll();
        setTimeout(run, CHECK_INTERVAL_MS);
      };
      run();
    },
  };
}
