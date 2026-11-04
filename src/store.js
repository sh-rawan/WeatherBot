import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Saves each user's location. Without a path, data is kept in memory only. */
export function createStore(path) {
  const users = new Map(
    path && existsSync(path) ? Object.entries(JSON.parse(readFileSync(path, 'utf8'))) : [],
  );

  const persist = () => {
    if (!path) return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(Object.fromEntries(users), null, 2));
  };

  return {
    getLocation: (userId) => users.get(userId),
    /** Replaces the whole record, so a new place gets checked again tonight. */
    setLocation(userId, location) {
      users.set(userId, location);
      persist();
    },
    getUsers: () => [...users],
    updateUser(userId, fields) {
      if (!users.has(userId)) return;
      users.set(userId, { ...users.get(userId), ...fields });
      persist();
    },
    deleteUser(userId) {
      if (users.delete(userId)) persist();
    },
  };
}
