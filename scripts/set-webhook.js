// Points Telegram at the deployed Worker. Usage: npm run set-webhook -- https://your-worker.workers.dev
import { createTelegramClient, WEBHOOK_PATH } from '../src/telegram.js';

const { TELEGRAM_BOT_TOKEN: token, WEBHOOK_SECRET: secret } = process.env;
const base = process.argv[2];
if (!token || !secret || !base?.startsWith('https://')) {
  console.error('Set TELEGRAM_BOT_TOKEN and WEBHOOK_SECRET in .env, and pass the Worker URL.');
  process.exit(1);
}

const client = createTelegramClient({ token });
await client.setWebhook(new URL(WEBHOOK_PATH, base).href, secret);
const info = await client.getWebhookInfo();
console.log(`Webhook set to ${info.url}`);
