import { setDefaultResultOrder } from 'node:dns';
import { createBot, MAIN_KEYBOARD } from './bot.js';
import { createNotifier } from './notifier.js';
import { createStore } from './store.js';
import { createTelegramClient, startPolling } from './telegram.js';
import { fetchForecast } from './weather.js';

// IPv6 routes to Telegram can be unreliable (seen failing half the time), so try IPv4 first.
setDefaultResultOrder('ipv4first');

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set. Add it to .env, or try `npm run simulate`.');
  process.exit(1);
}

const client = createTelegramClient({ token });

let me;
try {
  me = await client.getMe();
} catch (err) {
  console.error(`Could not connect to Telegram. Check your token and network. ${err.message}`);
  process.exit(1);
}

const store = createStore('data/users.json');
const bot = createBot({ messenger: client, store, fetchForecast });

console.log(`Running as @${me.username}`);
createNotifier({ messenger: client, store, fetchForecast, keyboard: MAIN_KEYBOARD }).start();
startPolling({ client, onUpdate: bot.handleUpdate });
