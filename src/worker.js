import { createBot, MAIN_KEYBOARD } from './bot.js';
import { createNotifier } from './notifier.js';
import { createD1Store } from './store.js';
import { createTelegramClient, WEBHOOK_PATH } from './telegram.js';
import { fetchForecast } from './weather.js';

function isSameSecret(received, expected) {
  if (!received || !expected || received.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

function dependencies(env) {
  return {
    messenger: createTelegramClient({ token: env.TELEGRAM_BOT_TOKEN }),
    store: createD1Store(env.DB),
    fetchForecast,
  };
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method === 'GET' && pathname === '/health') return new Response('ok');
    if (request.method !== 'POST' || pathname !== WEBHOOK_PATH) return new Response(null, { status: 404 });

    const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (!isSameSecret(secret, env.WEBHOOK_SECRET)) return new Response(null, { status: 403 });

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response(null, { status: 400 });
    }

    try {
      await createBot(dependencies(env)).handleUpdate(update);
      return new Response('ok');
    } catch (err) {
      // Telegram sends the update again after an error, so a failed reply gets retried.
      console.error('Failed to handle update:', err.message);
      return new Response(null, { status: 500 });
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(createNotifier({ ...dependencies(env), keyboard: MAIN_KEYBOARD }).checkAll());
  },
};
