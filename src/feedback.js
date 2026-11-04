import { DAY_PARTS, dayOutlook, daySummary, PART_ICONS } from './outlook.js';

const LIKE = 'like';
const DISLIKE = 'dislike';
const TILE = 'tile'; // Tiles only display information, so tapping one does nothing.

export const isReaction = (data) => data === LIKE || data === DISLIKE;

/** The 👍 and 👎 row. The chosen one gets a tick, and can still be changed. */
function reactionRow(chosen) {
  const button = (icon, reaction) => ({
    text: chosen === reaction ? `✅ ${icon}` : icon,
    callback_data: reaction,
  });
  return [button('👍', LIKE), button('👎', DISLIKE)];
}

const tileRow = (icons) => icons.map((text) => ({ text, callback_data: TILE }));

/**
 * A day as a card: the icons as text, because phone notifications only show text, then
 * Telegram button tiles in a grid, with a picture for each part of the day above its
 * weather icons, and the reaction buttons last.
 */
export function cardMessage(day) {
  return {
    text: daySummary(day),
    keyboard: {
      inline_keyboard: [tileRow(PART_ICONS), tileRow(dayOutlook(day).icons.split('-')), reactionRow()],
    },
  };
}

/** The same card's buttons after a tap, keeping the tiles and ticking the choice. */
export function withReaction(replyMarkup, chosen) {
  const tiles = (replyMarkup?.inline_keyboard ?? []).slice(0, -1);
  return { inline_keyboard: [...tiles, reactionRow(chosen)] };
}

const round = (value) => Math.round(value * 10) / 10;

function describeHours(name, hours) {
  return {
    name,
    coldestC: round(Math.min(...hours.map((h) => h.tempC))),
    hottestC: round(Math.max(...hours.map((h) => h.tempC))),
    minFeelsC: round(Math.min(...hours.map((h) => h.feelsC))),
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
