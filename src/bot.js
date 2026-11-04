import { NOTIFY_HOUR } from './notifier.js';
import { summarizeDay } from './summary.js';
import { getDay, isInJapan } from './weather.js';

const SHARE_LABEL = '📍 Share my location';
const UPDATE_LABEL = '📍 Update location';
const FORECAST_ERROR = "Sorry, I couldn't get the forecast just now. Please try again in a minute.";
const OUTSIDE_JAPAN = 'Sorry, I only cover Japan for now, and that location looks like it is outside Japan.';
const NOTIFICATION_INTRO = `🔔 Every evening around ${NOTIFY_HOUR}:00 I'll check tomorrow, and message you only when it matters.
☔-🧣-🚫-🧣 means morning - afternoon - evening - night.
☔ umbrella, 🧣 cold, 🧥 very cold, ☀️ hot and sunny, 🚫 nothing needed.`;

const locationButton = (text) => ({ text, request_location: true });

const ASK_LOCATION_KEYBOARD = {
  keyboard: [[locationButton(SHARE_LABEL)]],
  resize_keyboard: true,
};

export const MAIN_KEYBOARD = {
  keyboard: [[{ text: 'Today' }, { text: 'Tomorrow' }], [locationButton(UPDATE_LABEL)]],
  resize_keyboard: true,
};

const DAYS = {
  today: { offset: 0, label: 'Today' },
  tomorrow: { offset: 1, label: 'Tomorrow' },
};

export function createBot({ messenger, store, fetchForecast, log = console }) {
  const askForLocation = (userId, intro) =>
    messenger.sendText(userId, `${intro} Tap the button below to share your location.`, ASK_LOCATION_KEYBOARD);

  const keyboardFor = (userId) => (store.getLocation(userId) ? MAIN_KEYBOARD : ASK_LOCATION_KEYBOARD);

  async function handleLocation(userId, { latitude: lat, longitude: lon }) {
    let text;
    try {
      const forecast = await fetchForecast(lat, lon);
      if (isInJapan(forecast)) {
        text = `${summarizeDay(getDay(forecast, DAYS.today.offset), DAYS.today.label)}\n\n${NOTIFICATION_INTRO}`;
        store.setLocation(userId, { lat, lon });
      } else {
        text = OUTSIDE_JAPAN;
      }
    } catch (err) {
      log.error('Forecast failed:', err.message);
      text = FORECAST_ERROR;
    }
    await messenger.sendText(userId, text, keyboardFor(userId));
  }

  async function sendDay(userId, { offset, label }) {
    const location = store.getLocation(userId);
    let text;
    try {
      const forecast = await fetchForecast(location.lat, location.lon);
      text = summarizeDay(getDay(forecast, offset), label);
    } catch (err) {
      log.error('Forecast failed:', err.message);
      text = FORECAST_ERROR;
    }
    await messenger.sendText(userId, text, MAIN_KEYBOARD);
  }

  async function handleMessage(userId, message) {
    if (message.location) {
      await handleLocation(userId, message.location);
      return;
    }

    const rawText = (message.text ?? '').trim();

    // Some Telegram apps, such as Desktop, can't share a location from the button.
    if (rawText === SHARE_LABEL || rawText === UPDATE_LABEL) {
      await messenger.sendText(
        userId,
        'Sharing a location needs the Telegram mobile app. Please open this chat on your phone and tap the button there.',
        keyboardFor(userId),
      );
      return;
    }

    if (!store.getLocation(userId)) {
      const intro =
        rawText === '/start'
          ? "Hi! I'll tell you how your day looks in Japan, starting with rain. ☔"
          : 'I need your location before I can check the weather.';
      await askForLocation(userId, intro);
      return;
    }

    const text = rawText.toLowerCase();
    if (Object.hasOwn(DAYS, text)) {
      await sendDay(userId, DAYS[text]);
      return;
    }

    await messenger.sendText(userId, 'Choose Today or Tomorrow to see how the day looks.', MAIN_KEYBOARD);
  }

  return {
    async handleUpdate({ message, my_chat_member: memberUpdate }) {
      // Only private chats: a location shared in a group shouldn't drive anyone's forecast.
      const chat = message?.chat ?? memberUpdate?.chat;
      if (chat?.type !== 'private') return;

      // Saved locations reload from JSON with string keys, so IDs are always strings.
      const userId = String(chat.id);
      if (message) await handleMessage(userId, message);
      else if (memberUpdate.new_chat_member.status === 'kicked') store.deleteUser(userId);
    },
  };
}
