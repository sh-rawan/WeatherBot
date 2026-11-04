const toUser = ({ lat, lon, timezone, last_checked_date: lastCheckedDate }) => ({
  lat,
  lon,
  timezone,
  ...(lastCheckedDate && { lastCheckedDate }),
});

/** Saves users in Cloudflare D1. See schema.sql for the table. */
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
      await db.prepare('UPDATE users SET last_checked_date = ? WHERE user_id = ?').bind(date, userId).run();
    },
    async deleteUser(userId) {
      await db.prepare('DELETE FROM users WHERE user_id = ?').bind(userId).run();
    },
  };
}

/** Keeps users in memory only, for the simulator and tests. */
export function createMemoryStore() {
  const users = new Map();
  return {
    getLocation: async (userId) => users.get(userId),
    setLocation: async (userId, location) => {
      users.set(userId, location);
    },
    getUsers: async () => [...users],
    markChecked: async (userId, date) => {
      if (users.has(userId)) users.set(userId, { ...users.get(userId), lastCheckedDate: date });
    },
    deleteUser: async (userId) => {
      users.delete(userId);
    },
  };
}
