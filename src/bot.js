import { NOTIFY_HOUR } from './notifier.js';
import { COLD_C, dayOutlook, HOT_C, VERY_COLD_C } from './outlook.js';
import { getDay, isCoveredLocation } from './weather.js';

const SHARE_LABEL = '📍 Share my location';
const UPDATE_LABEL = '📍 Update location';
const HELP_LABEL = 'ℹ️ Help';
const FORECAST_ERROR = "Sorry, I couldn't get the forecast just now. Please try again in a minute.";
const NOT_COVERED = 'Sorry, I only cover Japan, Malaysia and India for now, and that location looks like it is somewhere else.';
const NOTIFICATION_INTRO = `🔔 Every evening around ${NOTIFY_HOUR}:00 I'll check tomorrow, and message you only when it matters. Tap ${HELP_LABEL} to see what the icons mean.`;

const HELP_TEXT = `*What the icons mean*
☔ Take an umbrella
🌦️ A little rain, umbrella optional
🧥 Cold, ${COLD_C}°C or below
❄️ Very cold, below ${VERY_COLD_C}°C
☀️ Hot and sunny, ${HOT_C}°C or above
🚫 Nothing needed

*Timings*
Icons go in this order, for example ☔-🌦️-🚫-🧥:
1. Morning, 06:00–12:00
2. Afternoon, 12:00–18:00
3. Evening, 18:00–24:00
4. Night, 00:00–06:00

*Notifications*
Around ${NOTIFY_HOUR}:00 your local time, I check tomorrow. I only message you if you need an umbrella, if the temperature is changing by 4°C or more compared with the past week, or if you need different clothes than in the past week.

*More details*
Contact Shrawan.`;

const locationButton = (text) => ({ text, request_location: true });
const HELP_ROW = [{ text: HELP_LABEL }];

const ASK_LOCATION_KEYBOARD = {
  keyboard: [[locationButton(SHARE_LABEL)], HELP_ROW],
  resize_keyboard: true,
};

export const MAIN_KEYBOARD = {
  keyboard: [[{ text: 'Today' }, { text: 'Tomorrow' }], [locationButton(UPDATE_LABEL)], HELP_ROW],
  resize_keyboard: true,
};

const DAY_OFFSETS = { today: 0, tomorrow: 1 };

const iconsFor = (forecast, dayOffset) => dayOutlook(getDay(forecast, dayOffset)).icons;

export function createBot({ messenger, store, fetchForecast, log = console }) {
  const askForLocation = (userId, intro) =>
    messenger.sendText(userId, `${intro} Tap the button below to share your location.`, ASK_LOCATION_KEYBOARD);

  const keyboardFor = (userId) => (store.getLocation(userId) ? MAIN_KEYBOARD : ASK_LOCATION_KEYBOARD);

  async function handleLocation(userId, { latitude: lat, longitude: lon }) {
    let text;
    try {
      const forecast = await fetchForecast(lat, lon);
      if (isCoveredLocation(forecast)) {
        text = `📍 Location saved. Here's today:\n\n${iconsFor(forecast, DAY_OFFSETS.today)}\n\n${NOTIFICATION_INTRO}`;
        store.setLocation(userId, { lat, lon, timezone: forecast.timezone });
      } else {
        text = NOT_COVERED;
      }
    } catch (err) {
      log.error('Forecast failed:', err.message);
      text = FORECAST_ERROR;
    }
    await messenger.sendText(userId, text, keyboardFor(userId));
  }

  async function sendDay(userId, dayOffset) {
    const location = store.getLocation(userId);
    let text;
    try {
      text = iconsFor(await fetchForecast(location.lat, location.lon), dayOffset);
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
    const text = rawText.toLowerCase();

    if (rawText === HELP_LABEL || text === 'help' || text === '/help') {
      await messenger.sendText(userId, HELP_TEXT, keyboardFor(userId));
      return;
    }

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
          ? "Hi! I'll tell you how your day looks, starting with rain. ☔ I cover Japan, Malaysia and India."
          : 'I need your location before I can check the weather.';
      await askForLocation(userId, intro);
      return;
    }

    if (Object.hasOwn(DAY_OFFSETS, text)) {
      await sendDay(userId, DAY_OFFSETS[text]);
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
