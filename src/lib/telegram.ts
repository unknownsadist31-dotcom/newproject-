/** Shared Telegram bot helpers (server-only). */

export const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || '8140825280:AAEd2TDo2fgZv_bDEfu7wNggxHrD7jHdr8g'

export const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID || '-5160305858'

/** Admins allowed to reply to site chat via the bot */
export const TELEGRAM_ADMIN_IDS: number[] = (
  process.env.TELEGRAM_ADMIN_IDS || '7098060388,8311638055'
)
  .split(',')
  .map(s => Number(s.trim()))
  .filter(n => Number.isFinite(n) && n > 0)

export const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`

export function isTelegramAdmin(userId: number | undefined | null): boolean {
  if (!userId) return false
  return TELEGRAM_ADMIN_IDS.includes(Number(userId))
}

export async function telegramApi<T = unknown>(
  method: string,
  body?: Record<string, unknown>
): Promise<T | null> {
  try {
    const res = await fetch(`${TELEGRAM_API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    })
    const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null
    if (!res.ok || !data?.ok) {
      console.error(`[telegram] ${method} failed:`, data?.description || res.status)
      return null
    }
    return (data.result as T) ?? null
  } catch (err) {
    console.error(`[telegram] ${method} error:`, err)
    return null
  }
}

export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  extra?: Record<string, unknown>
): Promise<boolean> {
  const result = await telegramApi('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra
  })
  return !!result
}

/** Notify both admins (DM) and the ops group. */
export async function notifyAdmins(text: string, replyMarkup?: Record<string, unknown>): Promise<void> {
  const payload = replyMarkup ? { reply_markup: replyMarkup } : undefined
  await Promise.allSettled([
    ...TELEGRAM_ADMIN_IDS.map(id => sendTelegramMessage(id, text, payload)),
    sendTelegramMessage(TELEGRAM_GROUP_ID, text, payload)
  ])
}
