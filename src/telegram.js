const API = 'https://api.telegram.org';
export const WEBHOOK_PATH = '/telegram/webhook';

export function createTelegramClient({ token }) {
  async function call(method, body) {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description} (${data.error_code})`);
    return data.result;
  }

  return {
    getMe: () => call('getMe', {}),
    getWebhookInfo: () => call('getWebhookInfo', {}),
    setWebhook: (url, secretToken) =>
      call('setWebhook', {
        url,
        secret_token: secretToken,
        allowed_updates: ['message', 'my_chat_member'],
      }),
    sendText: (chatId, text, keyboard) =>
      call('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        ...(keyboard && { reply_markup: keyboard }),
      }),
  };
}
