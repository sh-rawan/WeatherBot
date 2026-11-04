// A stand-in for Cloudflare D1, which is SQLite, that runs the real SQL and schema.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createD1Store } from '../src/store.js';

export function createFakeD1() {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      const statement = (params) => ({
        bind: (...next) => statement(next),
        first: async () => database.prepare(sql).get(...params) ?? null,
        all: async () => ({ results: database.prepare(sql).all(...params) }),
        run: async () => database.prepare(sql).run(...params),
      });
      return statement([]);
    },
  };
}

export const createD1StoreForTest = (db) => createD1Store(db);
