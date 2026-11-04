import { DAY_PARTS, dayOutlook } from './outlook.js';

const LIKE = 'like';
const DISLIKE = 'dislike';

export const isReaction = (data) => data === LIKE || data === DISLIKE;

/** The 👍 and 👎 buttons under a card. The chosen one gets a tick, and can still be changed. */
export function reactionKeyboard(chosen) {
  const button = (icon, reaction) => ({
    text: chosen === reaction ? `✅ ${icon}` : icon,
    callback_data: reaction,
  });
  return { inline_keyboard: [[button('👍', LIKE), button('👎', DISLIKE)]] };
}

const round = (value) => Math.round(value * 10) / 10;

function describeHours(name, hours) {
  return {
    name,
    coldestC: round(Math.min(...hours.map((h) => h.tempC))),
    hottestC: round(Math.max(...hours.map((h) => h.tempC))),
    maxFeelsC: round(Math.max(...hours.map((h) => h.feelsC))),
    rainMm: round(hours.reduce((total, h) => total + h.precipMm, 0)),
    rainChance: Math.max(0, ...hours.map((h) => h.precipProb)),
  };
}

/** What gets logged for a card, so reactions can later be compared with the weather. */
export function buildSuggestion({ userId, messageId, source, day, reasons, timezone, sentAt, changeC }) {
  const parts = DAY_PARTS.map(({ name, from, to }) => describeHours(name, day.hours.slice(from, to)));
  parts.push(describeHours('Night', day.nextNight));
  return {
    userId,
    messageId,
    source,
    sentAt,
    forecastDate: day.date,
    timezone,
    icons: dayOutlook(day).icons,
    reasons,
    snapshot: { parts, ...(changeC !== undefined && { changeC: round(changeC) }) },
  };
}
