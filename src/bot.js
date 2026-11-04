import { buildSuggestion, cardMessage, isReaction, withReaction } from './feedback.js';
import { NOTIFY_HOUR } from './notifier.js';
import { COLD_C, COOL_C, dayCard, VERY_COLD_C } from './outlook.js';
import { getDay, isCoveredLocation } from './weather.js';

const SHARE_LABEL = '📍 Share my location';
const UPDATE_LABEL = '📍 Update location';
const HELP_LABEL = 'ℹ️ Help';
const STOP_LABEL = '🔕 Stop notifications';
const RESUME_LABEL = '🔔 Turn on notifications';
const USE_BUTTONS = '👇 Tap a button below.';
const FORECAST_ERROR = "Sorry, I couldn't get the forecast just now. Please try again in a minute.";
const NOT_COVERED = 'Sorry, I only cover Japan, Malaysia and India for now, and that location looks like it is somewhere else.';
const NOTIFICATION_INTRO = `🔔 Every evening around ${NOTIFY_HOUR}:00 I'll check tomorrow, and message you only when it matters. Tap ${HELP_LABEL} to see what the icons mean.`;
const NOTIFICATIONS_OFF_NOTE = `🔕 Your evening notifications are off. Tap ${RESUME_LABEL} to turn them back on.`;
const STOPPED_TEXT = `🔕 Evening notifications are off. Today and Tomorrow still work whenever you tap them.`;
const RESUMED_TEXT = `🔔 Evening notifications are on. I'll message you around ${NOTIFY_HOUR}:00 when it matters.`;

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

Tap 🔕 to stop these messages, and 🔔 to turn them back on.

*More details*

Contact Shrawan: @shra1agl`;

const locationButton = (text) => ({ text, request_location: true });
const HELP_ROW = [{ text: HELP_LABEL }];

// Keeps the buttons on screen in place of the phone's keyboard. Telegram doesn't let a
// bot remove the text box, so typed messages just get pointed back to the buttons.
const BUTTONS_ONLY = { resize_keyboard: true, is_persistent: true, input_field_placeholder: 'Tap a button below' };

const ASK_LOCATION_KEYBOARD = {
  keyboard: [[locationButton(SHARE_LABEL)], HELP_ROW],
  ...BUTTONS_ONLY,
};

const mainKeyboard = (user) => ({
  keyboard: [
    [{ text: 'Today' }, { text: 'Tomorrow' }],
    [locationButton(UPDATE_LABEL)],
    [{ text: user.notificationsOffAt ? RESUME_LABEL : STOP_LABEL }],
    HELP_ROW,
  ],
  ...BUTTONS_ONLY,
});

// Keyed by the exact text each button sends.
const DAYS = {
  Today: { offset: 0, source: 'today', reasons: ['requested'] },
  Tomorrow: { offset: 1, source: 'tomorrow', reasons: ['requested'] },
};

// Tagged in the log, so test cards can be left out of any analysis.
const TEST_DAY = { offset: 0, source: 'test', reasons: ['test'] };

const cardFor = (forecast, { offset }) => dayCard(getDay(forecast, offset));

export function createBot({ messenger, store, fetchForecast, adminId, log = console }) {
  const askForLocation = (userId, text) =>
    messenger.sendText(userId, text, ASK_LOCATION_KEYBOARD);

  const keyboardFor = async (userId) => {
    const user = await store.getLocation(userId);
    return user ? mainKeyboard(user) : ASK_LOCATION_KEYBOARD;
  };

  async function handleLocation(userId, { latitude: lat, longitude: lon }) {
    let text;
    try {
      const forecast = await fetchForecast(lat, lon);
      if (isCoveredLocation(forecast)) {
        await store.setLocation(userId, { lat, lon, timezone: forecast.timezone });
        const { notificationsOffAt } = await store.getLocation(userId);
        const note = notificationsOffAt ? NOTIFICATIONS_OFF_NOTE : NOTIFICATION_INTRO;
        text = `📍 *Location saved*\n\n${cardFor(forecast, DAYS.Today)}\n\n${note}`;
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
      await messenger.sendText(userId, FORECAST_ERROR, mainKeyboard(location));
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

    // Only the exact text sent by a button counts, plus /start from Telegram's Start button.
    const rawText = message.text ?? '';

    if (rawText === HELP_LABEL) {
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

    const user = await store.getLocation(userId);
    if (!user) {
      const intro =
        rawText === '/start'
          ? "Hi! I'll tell you how your day looks, starting with rain. ☔ I cover Japan, Malaysia and India. Tap the button below to share your location."
          : '👇 Share your location to start.';
      await askForLocation(userId, intro);
      return;
    }

    if (rawText === STOP_LABEL || rawText === RESUME_LABEL) {
      const turnOff = rawText === STOP_LABEL;
      // Tapping an old button twice keeps the original time they were turned off.
      if (turnOff !== Boolean(user.notificationsOffAt)) {
        await store.setNotificationsOff(userId, turnOff ? new Date().toISOString() : null);
      }
      await messenger.sendText(userId, turnOff ? STOPPED_TEXT : RESUMED_TEXT, await keyboardFor(userId));
      return;
    }

    if (rawText === '/test' && adminId && userId === String(adminId)) {
      await sendDay(userId, TEST_DAY);
      return;
    }

    if (Object.hasOwn(DAYS, rawText)) {
      await sendDay(userId, DAYS[rawText]);
      return;
    }

    await messenger.sendText(userId, USE_BUTTONS, mainKeyboard(user));
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
