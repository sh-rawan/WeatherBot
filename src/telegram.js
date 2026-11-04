const API = 'https://api.telegram.org';
const LONG_POLL_SECONDS = 30;
const RETRY_DELAY_MS = 5000;

export function createTelegramClient({ token }) {
  async function call(method, body, timeoutMs = 10_000) {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description} (${data.error_code})`);
    return data.result;
  }

  return {
    getMe: () => call('getMe', {}),
    sendText: (chatId, text, keyboard) =>
      call('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        ...(keyboard && { reply_markup: keyboard }),
      }),
    getUpdates: (offset) =>
      call(
        'getUpdates',
        { offset, timeout: LONG_POLL_SECONDS, allowed_updates: ['message', 'my_chat_member'] },
        (LONG_POLL_SECONDS + 10) * 1000,
      ),
  };
}

/** Handles one batch of updates and returns the offset that confirms them to Telegram. */
export async function pollOnce({ client, offset, onUpdate, log = console }) {
  let nextOffset = offset;
  for (const update of await client.getUpdates(offset)) {
    nextOffset = update.update_id + 1;
    try {
      await onUpdate(update);
    } catch (err) {
      log.error('Failed to handle update:', err.message);
    }
  }
  return nextOffset;
}

export async function startPolling({ client, onUpdate, log = console }) {
  let offset;
  for (;;) {
    try {
      offset = await pollOnce({ client, offset, onUpdate, log });
    } catch (err) {
      log.error('Polling failed:', err.message);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}
