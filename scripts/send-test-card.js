// Sends a test card to the admin only, through the live bot. Usage: npm run test-message
import { setDefaultResultOrder } from 'node:dns';
import { TEST_MESSAGE_PATH } from '../src/telegram.js';

setDefaultResultOrder('ipv4first');

const { WORKER_URL: base, WEBHOOK_SECRET: secret } = process.env;
if (!base || !secret) {
  console.error('Set WORKER_URL and WEBHOOK_SECRET in .env.');
  process.exit(1);
}

const res = await fetch(new URL(TEST_MESSAGE_PATH, base), {
  method: 'POST',
  headers: { 'X-Telegram-Bot-Api-Secret-Token': secret },
  signal: AbortSignal.timeout(30_000),
});
console.log(res.ok ? 'Test card sent to the admin.' : `Failed with status ${res.status}.`);
if (!res.ok) process.exit(1);
