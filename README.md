# WeatherBot

A Telegram bot that asks for your location and tells you how your day looks, focusing on rain for now. It covers Japan, Malaysia and India, and declines locations elsewhere. Forecasts come from [Open-Meteo](https://open-meteo.com/), which needs no API key for non-commercial use.

Requires Node 22.9 or newer. There are no dependencies to install.

## Buttons only

Users control the bot with buttons, not by typing. The buttons stay on screen in place of the phone's keyboard, and a typed message only gets pointed back to them. Telegram doesn't let a bot remove the text box, so someone can still reach it through the keyboard icon. A typed message that exactly matches a button's text counts as tapping it, because Telegram sends them the same way.

## Daily notifications

Every evening from 20:00 local time, the bot checks tomorrow's forecast for each user. If it's worth a message, it sends a small icons-only card. The message text holds the weather icons on one line, in the order morning, afternoon, evening, night, because phone notifications only show text. Below it is a grid of Telegram button tiles, with a picture for each part of the day above its weather icons, then 👍 and 👎:

```
☔ · 🧥 · 🚫 · 🧥

[🌅] [🌞] [🌇] [🌙]
[☔] [🧥] [🚫] [🧥]
[  👍  ] [  👎  ]
```

The parts are 🌅 morning (06:00–12:00), 🌞 afternoon (12:00–18:00), 🌇 evening (18:00–24:00) and 🌙 the night that follows (00:00–06:00).

| Icon | Meaning | Rule for that part of the day |
| --- | --- | --- |
| ☔ | Must carry an umbrella | Rain totals at least 2 mm, or any hour has at least a 70% chance and rain totals at least 1 mm |
| 🌦️ | A little rain | Any other rain: any hour has at least a 50% chance, or rain totals at least 1 mm |
| 🍃 | Mildly cold | Coldest hour feels like 23°C or below |
| 🧥 | Very cold | Coldest hour feels like 15°C or below |
| ❄️ | Freezing | Coldest hour feels like below 5°C |
| ☀️ | Sweaty or sunny | Before 18:00, an hour feels like 35°C or more, or has a clear sky and feels like 25°C or more |
| 🚫 | Nothing needed | None of the above |

A part can show two icons, such as ☔🧥.

A message is sent when one of these is true:

- ☔ shows for morning, afternoon or evening. This always sends a message, even many days in a row. 🌦️ alone doesn't send one, but it still appears in any message sent for another reason.
- 🍃, 🧥 or ❄️ shows for morning, afternoon or evening, or ☀️ shows because it feels sweaty, and that weather didn't happen in the past 7 days, so you'd need different clothes than usual. A jacket in the middle of winter isn't news. Colder levels cover milder ones, so moving from ❄️ to 🧥 stays quiet.
- Tomorrow's average temperature from 06:00 to midnight is at least 4°C colder or warmer than today's. This only sends when the change starts, not on each day it continues in the same direction.

Weather at night, and ☀️ for sunshine alone, shows an icon but never causes a message by itself. You can change these values at the top of `src/outlook.js` and `src/notifier.js`.

Tapping **🔕 Stop notifications** turns the evening check off for that user, and **🔔 Turn on notifications** turns it back on. **Today** and **Tomorrow** keep working either way. Tapping **Today** or **Tomorrow** replies with the same card at any time, and **ℹ️ Help** explains the icons and timings.

The check runs every 5 minutes and handles up to 3 users each time, so anyone not reached at 20:00 is picked up by a later run before their midnight.

## Feedback

Every card from the evening check, **Today** and **Tomorrow** has 👍 and 👎 buttons. Each card sent adds a row to the `suggestions` table, with its reaction set to `none`. A tap changes that to `like` or `dislike`, and the latest tap wins.

Each row also records why the card was sent, its icons, and the weather numbers behind them. See `schema.sql` for the columns. It doesn't store coordinates, and rows are kept if a user blocks the bot.

To see totals:

```
npm run feedback
```

## Admin testing

One user is the admin, set by the `ADMIN_USER_ID` secret in Cloudflare. Test messages only ever go to the admin:

- The admin can send `/test` to the bot. From anyone else, it's treated as an unknown message.
- `npm run test-message` sends a test card through the live bot, using `WORKER_URL` and `WEBHOOK_SECRET` from `.env`.

Test cards show today's forecast, whether or not it would normally send a message. They're logged with the source `test`, so leave those rows out when analysing feedback.

## Try it without Telegram

```
npm run simulate
```

This runs the real bot logic against live forecasts in your terminal:

```
you> loc 35.68 139.76
you> Tomorrow
```

## Run the tests

```
npm test
```

## Hosting

The bot runs on [Cloudflare Workers](https://developers.cloudflare.com/workers/), so it doesn't need your PC or ngrok. Telegram sends each message to a webhook, a schedule runs the evening check, and users are saved in a Cloudflare D1 database.

To deploy a code change:

```
npm run deploy
```

To watch the live bot's logs:

```
npm run logs
```

## Set it up from scratch

1. In Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`, and follow the prompts to get a token.
2. Copy `.env.example` to `.env`. Add the token, and set `WEBHOOK_SECRET` to a long random string.
3. Log in to Cloudflare: `npx wrangler login`
4. Create the database: `npx wrangler d1 create weatherbot`, then put its ID in `wrangler.jsonc`.
5. Create the table: `npx wrangler d1 execute weatherbot --remote --file schema.sql`
6. Store both values from `.env` in Cloudflare: `npx wrangler secret put TELEGRAM_BOT_TOKEN` and `npx wrangler secret put WEBHOOK_SECRET`
7. Deploy: `npm run deploy`. Later, store your Telegram user ID as the admin: `npx wrangler secret put ADMIN_USER_ID`. On a new account, Cloudflare first asks you to choose a `workers.dev` subdomain.
8. Point Telegram at the printed address: `npm run set-webhook -- https://your-worker.workers.dev`
9. Open your bot in the Telegram **mobile** app and press **Start**. Sharing a location from the button may not work on desktop.

## Code layout

| File | Purpose |
| --- | --- |
| `src/weather.js` | Fetches the forecast and lines up its hourly values |
| `src/outlook.js` | Chooses the icons for each part of the day |
| `src/notifier.js` | Decides whether a day is worth a message, and sends it |
| `src/feedback.js` | The reaction buttons, and what gets logged for each card |
| `src/bot.js` | Conversation flow and keyboards |
| `src/telegram.js` | Telegram API calls |
| `src/store.js` | Saves user locations in D1 |
| `src/worker.js` | Cloudflare entry point for the webhook and schedule |
| `schema.sql` | The database table |
| `wrangler.jsonc` | Cloudflare settings, including the schedule |
