import {
  appendMessage,
  clearAdminPending,
  getAdminPending,
  getSession,
  listRecentSessions,
  setAdminPending
} from '@/lib/support-chat-store'
import { isTelegramAdmin, notifyAdmins, sendTelegramMessage, telegramApi } from '@/lib/telegram'

type TgUser = { id: number; first_name?: string; username?: string }
type TgChat = { id: number; type: string }
type TgMessage = {
  message_id: number
  chat: TgChat
  from?: TgUser
  text?: string
  date?: number
}
type TgCallback = {
  id: string
  from: TgUser
  message?: TgMessage
  data?: string
}
export type TgUpdate = {
  update_id: number
  message?: TgMessage
  callback_query?: TgCallback
}

function esc(s: string) {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function sessionSummary(sessionId: string) {
  const s = getSession(sessionId)
  if (!s) return null
  const lastUser = [...s.messages].reverse().find(m => m.role === 'user')
  return {
    session: s,
    lastUserText: lastUser?.text || '(no user message yet)',
    msgCount: s.messages.filter(m => m.role !== 'system').length
  }
}

export async function notifyNewUserMessage(sessionId: string, text: string) {
  const info = sessionSummary(sessionId)
  if (!info) return

  const { session, msgCount } = info
  const body =
    `💬 <b>New support chat message</b>\n` +
    `\n` +
    `<b>Session:</b> <code>${esc(session.id)}</code>\n` +
    `<b>User:</b> ${esc(session.userLabel)}\n` +
    `<b>Messages:</b> ${msgCount}\n` +
    (session.pageUrl ? `<b>Page:</b> ${esc(session.pageUrl)}\n` : '') +
    `\n` +
    `<b>Message:</b>\n${esc(text)}\n` +
    `\n` +
    `Tap <b>Reply</b> then type your answer, or send:\n` +
    `<code>/reply ${esc(session.id)} your message</code>`

  await notifyAdmins(body, {
    inline_keyboard: [
      [
        { text: '💬 Reply', callback_data: `reply:${session.id}` },
        { text: '📋 History', callback_data: `hist:${session.id}` }
      ]
    ]
  })
}

async function deliverAdminReply(
  sessionId: string,
  text: string,
  admin: TgUser
): Promise<{ ok: boolean; error?: string }> {
  const session = getSession(sessionId)
  if (!session) return { ok: false, error: 'session not found' }

  const name = admin.username ? `@${admin.username}` : admin.first_name || `Admin ${admin.id}`
  const msg = appendMessage(sessionId, 'admin', text, name)
  if (!msg) return { ok: false, error: 'could not save reply' }

  clearAdminPending(admin.id)
  return { ok: true }
}

async function handleCallback(cb: TgCallback) {
  const chatId = cb.message?.chat.id
  const data = cb.data || ''
  const admin = cb.from

  await telegramApi('answerCallbackQuery', { callback_query_id: cb.id })

  if (!chatId || !isTelegramAdmin(admin.id)) {
    if (chatId) await sendTelegramMessage(chatId, '⛔ You are not authorized to manage support chats.')
    return
  }

  if (data.startsWith('reply:')) {
    const sessionId = data.slice('reply:'.length)
    if (!getSession(sessionId)) {
      await sendTelegramMessage(chatId, '⚠️ Session not found (may have expired).')
      return
    }
    setAdminPending(admin.id, sessionId)
    await sendTelegramMessage(
      chatId,
      `✍️ <b>Reply mode</b>\nSession: <code>${esc(sessionId)}</code>\n\nType your reply now (or /cancel).`
    )
    return
  }

  if (data.startsWith('hist:')) {
    const sessionId = data.slice('hist:'.length)
    const session = getSession(sessionId)
    if (!session) {
      await sendTelegramMessage(chatId, '⚠️ Session not found.')
      return
    }
    const lines = session.messages
      .filter(m => m.role !== 'system')
      .slice(-12)
      .map(m => {
        const who = m.role === 'user' ? '👤 User' : `🛡 ${m.adminName || 'Admin'}`
        return `${who}: ${esc(m.text)}`
      })
    await sendTelegramMessage(
      chatId,
      `📋 <b>History</b> <code>${esc(sessionId)}</code>\n\n${lines.join('\n\n') || '(empty)'}`
    )
  }
}

async function handleMessage(msg: TgMessage) {
  const text = (msg.text || '').trim()
  if (!text || !msg.from) return

  const chatId = msg.chat.id
  const admin = msg.from

  // Group messages other than commands are ignored
  if (msg.chat.type !== 'private' && !text.startsWith('/')) return

  if (!isTelegramAdmin(admin.id)) {
    if (msg.chat.type === 'private') {
      await sendTelegramMessage(chatId, 'This bot is for THORSwap support admins only.')
    }
    return
  }

  if (text === '/start' || text === '/help') {
    await sendTelegramMessage(
      chatId,
      `🟢 <b>THORSwap Support Bot</b>\n\n` +
        `When a visitor chats on the site, you get a notification here.\n\n` +
        `<b>Commands</b>\n` +
        `/reply <session_id> <message> — send a reply\n` +
        `/pending — list recent open chats\n` +
        `/cancel — leave reply mode\n` +
        `/help — this message\n\n` +
        `Or tap <b>Reply</b> under a notification, then type your answer.`
    )
    return
  }

  if (text === '/cancel') {
    clearAdminPending(admin.id)
    await sendTelegramMessage(chatId, 'Cancelled reply mode.')
    return
  }

  if (text === '/pending' || text.startsWith('/pending ')) {
    const recent = listRecentSessions(10)
    if (!recent.length) {
      await sendTelegramMessage(chatId, 'No chat sessions yet.')
      return
    }
    const lines = recent.map(s => {
      const last = [...s.messages].reverse().find(m => m.role === 'user')
      return (
        `• <code>${esc(s.id)}</code> — ${esc(s.userLabel)}\n` +
        `  ${esc((last?.text || '').slice(0, 80) || '(no msg)')}`
      )
    })
    await sendTelegramMessage(chatId, `📬 <b>Recent chats</b>\n\n${lines.join('\n\n')}`)
    return
  }

  if (text.startsWith('/reply ')) {
    const rest = text.slice('/reply '.length).trim()
    const sp = rest.indexOf(' ')
    if (sp <= 0) {
      await sendTelegramMessage(chatId, 'Usage: <code>/reply SESSION_ID your message</code>')
      return
    }
    const sessionId = rest.slice(0, sp).trim()
    const replyText = rest.slice(sp + 1).trim()
    const result = await deliverAdminReply(sessionId, replyText, admin)
    if (!result.ok) {
      await sendTelegramMessage(chatId, `⚠️ Failed: ${result.error}`)
      return
    }
    await sendTelegramMessage(chatId, `✅ Reply delivered to <code>${esc(sessionId)}</code>`)
    return
  }

  // Pending typed reply
  const pending = getAdminPending(admin.id)
  if (pending?.mode === 'awaiting_reply') {
    const result = await deliverAdminReply(pending.sessionId, text, admin)
    if (!result.ok) {
      await sendTelegramMessage(chatId, `⚠️ Failed: ${result.error}`)
      return
    }
    await sendTelegramMessage(chatId, `✅ Reply delivered to <code>${esc(pending.sessionId)}</code>`)
    return
  }

  if (msg.chat.type === 'private') {
    await sendTelegramMessage(
      chatId,
      'No active reply mode.\nUse /pending or tap Reply on a chat notification.\n/help for commands.'
    )
  }
}

/** Process one Telegram update (webhook or long-poll forwarder). */
export async function handleTelegramUpdate(update: TgUpdate): Promise<void> {
  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query)
      return
    }
    if (update.message) {
      await handleMessage(update.message)
    }
  } catch (err) {
    console.error('[support-chat-bot] update error:', err)
  }
}
