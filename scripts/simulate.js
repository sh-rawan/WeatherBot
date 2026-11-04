// Chat with the real bot logic and live forecasts in your terminal, with no Telegram account.
import { createInterface } from 'node:readline';
import { createBot } from '../src/bot.js';
import { createMemoryStore } from '../src/store.js';
import { fetchForecast } from '../src/weather.js';

const chat = { id: 1, type: 'private' };

const messenger = {
  async sendText(_chatId, text, keyboard) {
    console.log(`\n${text}`);
    const buttons = keyboard?.keyboard ?? keyboard?.inline_keyboard;
    if (buttons) console.log(`\nButtons: ${buttons.flat().map((b) => `[${b.text}]`).join(' ')}`);
    return { message_id: 0 };
  },
};
const bot = createBot({ messenger, store: createMemoryStore(), fetchForecast });

const parseLocation = (line) => {
  const match = line.match(/^loc\s+(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)$/i);
  return match && { latitude: Number(match[1]), longitude: Number(match[2]) };
};

const send = (fields) => bot.handleUpdate({ message: { chat, ...fields } });

console.log('Telegram simulator. Type "loc <lat> <lon>" to share a location (e.g. loc 35.68 139.76 for Tokyo),');
console.log('any other text to send a message (today, tomorrow), or "exit" to quit.');

await send({ text: '/start' });

const prompt = () => process.stdout.write('\nyou> ');
const rl = createInterface({ input: process.stdin });
prompt();
for await (const raw of rl) {
  const line = raw.trim();
  if (line === 'exit') break;
  if (line) {
    const location = parseLocation(line);
    await send(location ? { location } : { text: line });
  }
  prompt();
}
rl.close();
