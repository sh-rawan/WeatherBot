const toUser = ({ lat, lon, timezone, last_checked_date: lastCheckedDate, notifications_off_at: notificationsOffAt }) => ({
  lat,
  lon,
  timezone,
  ...(lastCheckedDate && { lastCheckedDate }),
  ...(notificationsOffAt && { notificationsOffAt }),
});

const markCheckedStatement = (db, userId, date) =>
  db.prepare('UPDATE users SET last_checked_date = ? WHERE user_id = ?').bind(date, userId);

const insertSuggestion = (db, s) =>
  db
    .prepare(
      `INSERT INTO suggestions
         (user_id, telegram_message_id, source, sent_at, forecast_date, timezone, icons, reasons, snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      s.userId,
      s.messageId,
      s.source,
      s.sentAt,
      s.forecastDate,
      s.timezone,
      s.icons,
      JSON.stringify(s.reasons),
      JSON.stringify(s.snapshot),
    );

const toSuggestion = (row) => ({
  userId: row.user_id,
  messageId: row.telegram_message_id,
  source: row.source,
  sentAt: row.sent_at,
  forecastDate: row.forecast_date,
  timezone: row.timezone,
  icons: row.icons,
  reasons: JSON.parse(row.reasons),
  snapshot: JSON.parse(row.snapshot),
  reaction: row.reaction,
  ...(row.reacted_at && { reactedAt: row.reacted_at }),
});

/** Saves users and sent cards in Cloudflare D1. See schema.sql for the tables. */
export function createD1Store(db) {
  return {
    async getLocation(userId) {
      const row = await db.prepare('SELECT * FROM users WHERE user_id = ?').bind(userId).first();
      return row ? toUser(row) : undefined;
    },
    /** Clears the checked date, so a new place gets checked again tonight. */
    async setLocation(userId, { lat, lon, timezone }) {
      await db
        .prepare(
          `INSERT INTO users (user_id, lat, lon, timezone, last_checked_date) VALUES (?, ?, ?, ?, NULL)
           ON CONFLICT (user_id) DO UPDATE SET
             lat = excluded.lat, lon = excluded.lon, timezone = excluded.timezone, last_checked_date = NULL`,
        )
        .bind(userId, lat, lon, timezone)
        .run();
    },
    async getUsers() {
      const { results } = await db.prepare('SELECT * FROM users').all();
      return results.map((row) => [row.user_id, toUser(row)]);
    },
    async markChecked(userId, date) {
      await markCheckedStatement(db, userId, date).run();
    },
    /** Pass the time they were turned off, or null to turn them back on. */
    async setNotificationsOff(userId, at) {
      await db.prepare('UPDATE users SET notifications_off_at = ? WHERE user_id = ?').bind(at, userId).run();
    },
    async deleteUser(userId) {
      await db.prepare('DELETE FROM users WHERE user_id = ?').bind(userId).run();
    },
    async logSuggestion(suggestion) {
      await insertSuggestion(db, suggestion).run();
    },
    /** Saves both together, using one request, because the evening check has few to spare. */
    async logSuggestionAndMarkChecked(suggestion, userId, date) {
      await db.batch([insertSuggestion(db, suggestion), markCheckedStatement(db, userId, date)]);
    },
    async recordReaction(userId, messageId, reaction, at) {
      await db
        .prepare('UPDATE suggestions SET reaction = ?, reacted_at = ? WHERE user_id = ? AND telegram_message_id = ?')
        .bind(reaction, at, userId, messageId)
        .run();
    },
    async getSuggestions(userId) {
      const { results } = await db.prepare('SELECT * FROM suggestions WHERE user_id = ? ORDER BY id').bind(userId).all();
      return results.map(toSuggestion);
    },
  };
}

/** Keeps users in memory only, for the simulator and tests. */
export function createMemoryStore() {
  const users = new Map();
  const suggestions = [];
  const markChecked = (userId, date) => {
    if (users.has(userId)) users.set(userId, { ...users.get(userId), lastCheckedDate: date });
  };
  return {
    getLocation: async (userId) => users.get(userId),
    setLocation: async (userId, location) => {
      const notificationsOffAt = users.get(userId)?.notificationsOffAt;
      users.set(userId, { ...location, ...(notificationsOffAt && { notificationsOffAt }) });
    },
    getUsers: async () => [...users],
    markChecked: async (userId, date) => markChecked(userId, date),
    setNotificationsOff: async (userId, at) => {
      if (!users.has(userId)) return;
      const { notificationsOffAt, ...user } = users.get(userId);
      users.set(userId, { ...user, ...(at && { notificationsOffAt: at }) });
    },
    deleteUser: async (userId) => {
      users.delete(userId);
    },
    logSuggestion: async (suggestion) => {
      suggestions.push({ ...suggestion, reaction: 'none' });
    },
    logSuggestionAndMarkChecked: async (suggestion, userId, date) => {
      suggestions.push({ ...suggestion, reaction: 'none' });
      markChecked(userId, date);
    },
    recordReaction: async (userId, messageId, reaction, at) => {
      const match = suggestions.find((s) => s.userId === userId && s.messageId === messageId);
      if (match) Object.assign(match, { reaction, reactedAt: at });
    },
    getSuggestions: async (userId) => suggestions.filter((s) => s.userId === userId),
  };
}
