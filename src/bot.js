import { buildSuggestion, cardMessage, isReaction, withReaction } from './feedback.js';
import { NOTIFY_HOUR } from './notifier.js';
import { COLD_C, COOL_C, dayCard, VERY_COLD_C } from './outlook.js';
import { getDay, isCoveredLocation } from './weather.js';

const SHARE_LABEL = '📍 Share my location';
const UPDATE_LABEL = '📍 Update location';
const HELP_LABEL = 'ℹ️ Help';
const FORECAST_ERROR = "Sorry, I couldn't get the forecast just now. Please try again in a minute.";
const NOT_COVERED = 'Sorry, I only cover Japan, Malaysia and India for now, and that location looks like it is somewhere else.';
const NOTIFICATION_INTRO = `🔔 Every evening around ${NOTIFY_HOUR}:00 I'll check tomorrow, and message you only when it matters. Tap ${HELP_LABEL} to see what the icons mean.`;

const HELP_TEXT = `*What the icons mean*

☔  Take an umbrella
🌦️  A little rain, umbrella optional
🍃  Mildly cold, feels ${COOL_C}°C or below
🧥  Very cold, feels ${COLD_C}°C or below
❄️  Freezing, feels below ${VERY_COLD_C}°C
☀️  Sweaty hot, or sunny
🚫  Nothing needed

*Times of day*

🌅  Morning, 06:00–12:00
🌞  Afternoon, 12:00–18:00
🌇  Evening, 18:00–24:00
🌙  Night, 00:00–06:00

*When I message you*

Around ${NOTIFY_HOUR}:00 your local time, I check tomorrow. You'll only hear from me if:

•  You need an umbrella
•  It will be 4°C or more colder or warmer than today
•  You need different clothes than in the past week

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

const DAYS = {
  today: { offset: 0, source: 'today', reasons: ['requested'] },
  tomorrow: { offset: 1, source: 'tomorrow', reasons: ['requested'] },
};

// Tagged in the log, so test cards can be left out of any analysis.
const TEST_DAY = { offset: 0, source: 'test', reasons: ['test'] };

const cardFor = (forecast, { offset }) => dayCard(getDay(forecast, offset));

export function createBot({ messenger, store, fetchForecast, adminId, log = console }) {
  const askForLocation = (userId, intro) =>
    messenger.sendText(userId, `${intro} Tap the button below to share your location.`, ASK_LOCATION_KEYBOARD);

  const keyboardFor = async (userId) => ((await store.getLocation(userId)) ? MAIN_KEYBOARD : ASK_LOCATION_KEYBOARD);

  async function handleLocation(userId, { latitude: lat, longitude: lon }) {
    let text;
    try {
      const forecast = await fetchForecast(lat, lon);
      if (isCoveredLocation(forecast)) {
        text = `📍 *Location saved*\n\n${cardFor(forecast, DAYS.today)}\n\n${NOTIFICATION_INTRO}`;
        await store.setLocation(userId, { lat, lon, timezone: forecast.timezone });
      } else {
        text = NOT_COVERED;
      }
    } catch (err) {
      log.error('Forecast failed:', err.message);
      text = FORECAST_ERROR;
    }
    await messenger.sendText(userId, text, await keyboardFor(userId));
  }

  async function sendDay(userId, { offset, source, reasons }) {
    const location = await store.getLocation(userId);
    let day;
    try {
      day = getDay(await fetchForecast(location.lat, location.lon), offset);
    } catch (err) {
      log.error('Forecast failed:', err.message);
      await messenger.sendText(userId, FORECAST_ERROR, MAIN_KEYBOARD);
      return;
    }

    const card = cardMessage(day);
    const message = await messenger.sendText(userId, card.text, card.keyboard);
    try {
      await store.logSuggestion(
        buildSuggestion({
          userId,
          messageId: message.message_id,
          source,
          day,
          reasons,
          timezone: location.timezone,
          sentAt: new Date().toISOString(),
        }),
      );
    } catch (err) {
      // The card was delivered, so don't fail and make Telegram send the request again.
      log.error('Could not log suggestion:', err.message);
    }
  }

  async function handleReaction(userId, { id, data, message }) {
    // Tiles only display information, but Telegram still needs an answer to stop the spinner.
    if (!isReaction(data)) {
      await messenger.answerButton(id);
      return;
    }
    await store.recordReaction(userId, message.message_id, data, new Date().toISOString());
    await messenger.answerButton(id, 'Thanks for the feedback!');
    await messenger.setMessageKeyboard(userId, message.message_id, withReaction(message.reply_markup, data));
  }

  async function handleMessage(userId, message) {
    if (message.location) {
      await handleLocation(userId, message.location);
      return;
    }

    const rawText = (message.text ?? '').trim();
    const text = rawText.toLowerCase();

    if (rawText === HELP_LABEL || text === 'help' || text === '/help') {
      await messenger.sendText(userId, HELP_TEXT, await keyboardFor(userId));
      return;
    }

    // Some Telegram apps, such as Desktop, can't share a location from the button.
    if (rawText === SHARE_LABEL || rawText === UPDATE_LABEL) {
      await messenger.sendText(
        userId,
        'Sharing a location needs the Telegram mobile app. Please open this chat on your phone and tap the button there.',
        await keyboardFor(userId),
      );
      return;
    }

    if (!(await store.getLocation(userId))) {
      const intro =
        rawText === '/start'
          ? "Hi! I'll tell you how your day looks, starting with rain. ☔ I cover Japan, Malaysia and India."
          : 'I need your location before I can check the weather.';
      await askForLocation(userId, intro);
      return;
    }

    if (text === '/test' && adminId && userId === String(adminId)) {
      await sendDay(userId, TEST_DAY);
      return;
    }

    if (Object.hasOwn(DAYS, text)) {
      await sendDay(userId, DAYS[text]);
      return;
    }

    await messenger.sendText(userId, 'Choose Today or Tomorrow to see how the day looks.', MAIN_KEYBOARD);
  }

  return {
    /** Sends a test card to the admin, and never to anyone else. */
    async sendTestCard() {
      if (!adminId) throw new Error('No admin is set');
      const userId = String(adminId);
      if (!(await store.getLocation(userId))) throw new Error('The admin has no saved location');
      await sendDay(userId, TEST_DAY);
    },
    async handleUpdate({ message, my_chat_member: memberUpdate, callback_query: buttonTap }) {
      // Only private chats: a location shared in a group shouldn't drive anyone's forecast.
      const chat = message?.chat ?? memberUpdate?.chat ?? buttonTap?.message?.chat;
      if (chat?.type !== 'private') return;

      // The database stores IDs as text, so use strings everywhere.
      const userId = String(chat.id);
      if (message) await handleMessage(userId, message);
      else if (buttonTap) await handleReaction(userId, buttonTap);
      else if (memberUpdate.new_chat_member.status === 'kicked') await store.deleteUser(userId);
    },
  };
}
