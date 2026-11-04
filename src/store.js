import fs from 'node:fs';
import { dirname } from 'node:path';

const RENAME_ATTEMPTS = 5;
const RENAME_RETRY_MS = 100;
// Windows can briefly lock a file while OneDrive or antivirus software reads it.
const FILE_LOCKED_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function renameWithRetry(from, to) {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      if (attempt === RENAME_ATTEMPTS || !FILE_LOCKED_CODES.has(err.code)) throw err;
      sleep(RENAME_RETRY_MS);
    }
  }
}

/**
 * Writes to a temporary file, then swaps it into place in one step, so a crash
 * mid-save leaves the previous complete file rather than a half-written one.
 */
function saveJson(path, data) {
  const tempPath = `${path}.tmp`;
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), { flush: true });
  renameWithRetry(tempPath, path);
}

/** Saves each user's location. Without a path, data is kept in memory only. */
export function createStore(path) {
  const users = new Map(
    path && fs.existsSync(path) ? Object.entries(JSON.parse(fs.readFileSync(path, 'utf8'))) : [],
  );

  const persist = () => {
    if (path) saveJson(path, Object.fromEntries(users));
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
