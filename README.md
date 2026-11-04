# WeatherBot

A Telegram bot that asks for your location and tells you how your day looks, focusing on rain for now. It only covers Japan and declines locations elsewhere. Forecasts come from [Open-Meteo](https://open-meteo.com/), which needs no API key for non-commercial use.

Requires Node 22.9 or newer. There are no dependencies to install.

## Daily notifications

Every evening from 20:00 Japan time, the bot checks tomorrow's forecast for each user. If it's worth a message, it sends one icon slot per part of the day:

```
☔-🧣-🚫-🧣
```

The parts are morning (06:00–12:00), afternoon (12:00–18:00), evening (18:00–24:00) and the night that follows (00:00–06:00).

| Icon | Meaning | Rule for that part of the day |
| --- | --- | --- |
| ☔ | Umbrella | Any hour has at least a 50% chance of rain, or rain totals at least 1 mm |
| 🧣 | Cold | Coldest hour is 10°C or below |
| 🧥 | Very cold | Coldest hour is 0°C or below |
| ☀️ | Hot and sunny | An hour before 18:00 reaches 30°C with a clear sky |
| 🚫 | Nothing needed | None of the above |

A part can show two icons, such as ☔🧣.

A message is sent when one of these is true:

- ☔ shows for morning, afternoon or evening. Rain always sends a message, even many days in a row.
- 🧣, 🧥 or ☀️ shows for morning, afternoon or evening, and that weather didn't happen in the past 7 days, so you'd need different clothes than usual. A muffler in the middle of winter isn't news. Very cold days count as cold too, so moving from 🧥 to 🧣 stays quiet.

Weather at night shows an icon but never causes a message by itself. You can change these values at the top of `src/outlook.js` and `src/notifier.js`.

The bot has to be running for notifications to go out. If it's off at 20:00, the message is sent when it next runs before midnight.

## Try it without Telegram

```
npm run simulate
```

This runs the real bot logic against live forecasts in your terminal:

```
you> loc 35.68 139.76
you> tomorrow
```

## Run the tests

```
npm test
```

## Connect it to Telegram

1. In Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`, and follow the prompts to get a token.
2. Paste the token into `.env` as `TELEGRAM_BOT_TOKEN`. See `.env.example`.
3. Start the bot: `npm start`
4. Open your bot in the Telegram **mobile** app and press **Start**. Sharing a location from the button may not work on desktop.

The bot fetches its own messages from Telegram, so it doesn't need ngrok or a public URL. Only run one copy at a time, because Telegram rejects a second one.

## Code layout

| File | Purpose |
| --- | --- |
| `src/summary.js` | Turns a day's forecast into the Today and Tomorrow message text |
| `src/weather.js` | Fetches the forecast and lines up its hourly values |
| `src/outlook.js` | Chooses the icons for each part of the day |
| `src/notifier.js` | Decides whether a day is worth a message, and sends it |
| `src/bot.js` | Conversation flow and keyboards |
| `src/telegram.js` | Telegram API calls and fetching new messages |
| `src/store.js` | Saves user locations to `data/users.json` |
