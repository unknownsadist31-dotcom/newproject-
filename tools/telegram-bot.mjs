#!/usr/bin/env node
/**
 * Standalone THORSwap support bot (long-poll).
 *
 * Runs on the SAME host as the website and shares `data/support-chats.json`
 * with the Next.js app. Admin replies are written directly to that file —
 * no webhook / SITE_URL hop required (that was why replies looked "stuck").
 *
 *   npm run start          # website
 *   npm run bot            # this process (keep both up 24/7)
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_ADMIN_IDS     comma-separated (default 7098060388,8311638055)
 *   TELEGRAM_GROUP_ID
 *   CHAT_STORE_PATH        override path to support-chats.json
 */

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8140825280:AAEd2TDo2fgZv_bDEfu7wNggxHrD7jHdr8g'
const ADMIN_IDS = (process.env.TELEGRAM_ADMIN_IDS || '7098060388,8311638055')
  .split(',')
  .map(s => Number(s.trim()))
  .filter(n => Number.isFinite(n) && n > 0)
const GROUP_ID = process.env.TELEGRAM_GROUP_ID || '-5160305858'
const STORE_PATH =
  process.env.CHAT_STORE_PATH || path.join(ROOT, 'data', 'support-chats.json')
const API = `https://api.telegram.org/bot${TOKEN}`

let offset = 0
let running = true

// ── store (mirrors src/lib/support-chat-store.ts) ──────────────────────────

function emptyStore() {
  return { sessions: {}, adminPending: {} }
}

function ensureDir() {
  const dir = path.dirname(STORE_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function readStore() {
  try {
    ensureDir()
    if (!existsSync(STORE_PATH)) return emptyStore()
    const parsed = JSON.parse(readFileSync(STORE_PATH, 'utf8'))
    if (!parsed.sessions) parsed.sessions = {}
    if (!parsed.adminPending) parsed.adminPending = {}
    return parsed
  } catch {
    return emptyStore()
  }
}

function writeStore(data) {
  ensureDir()
  const tmp = `${STORE_PATH}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data), 'utf8')
  renameSync(tmp, STORE_PATH)
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function getSession(id) {
  return readStore().sessions[id] || null
}

function appendAdminMessage(sessionId, text, adminName) {
  const trimmed = String(text || '').trim()
  if (!trimmed || trimmed.length > 4000) return { ok: false, error: 'empty message' }
  const data = readStore()
  const session = data.sessions[sessionId]
  if (!session) return { ok: false, error: 'session not found' }
  const msg = {
    id: uid('msg'),
    role: 'admin',
    text: trimmed,
    ts: Date.now(),
    adminName: adminName || 'Support'
  }
  session.messages.push(msg)
  if (session.messages.length > 200) session.messages = session.messages.slice(-200)
  session.updatedAt = msg.ts
  writeStore(data)
  return { ok: true, msg }
}

function setPending(adminId, sessionId) {
  const data = readStore()
  if (!data.sessions[sessionId]) return false
  data.adminPending[String(adminId)] = {
    mode: 'awaiting_reply',
    sessionId,
    since: Date.now()
  }
  writeStore(data)
  return true
}

function clearPending(adminId) {
  const data = readStore()
  delete data.adminPending[String(adminId)]
  writeStore(data)
}

function getPending(adminId) {
  return readStore().adminPending[String(adminId)] || null
}

function listRecent(limit = 10) {
  return Object.values(readStore().sessions)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
}

// ── telegram ───────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

async function tg(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  })
  const data = await res.json().catch(() => null)
  if (!data?.ok) {
    console.error(`[bot] ${method} failed:`, data?.description || res.status)
  }
  return data
}

async function send(chatId, text, extra = {}) {
  return tg('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra
  })
}

function isAdmin(id) {
  return ADMIN_IDS.includes(Number(id))
}

function extractSessionId(text) {
  if (!text) return null
  // Session: `sess_xxx_yyy` or plain sess_xxx_yyy
  const m =
    String(text).match(/sess_[a-z0-9]+_[a-z0-9]+/i) ||
    String(text).match(/\/reply\s+(sess_[a-z0-9]+_[a-z0-9]+)/i)
  return m ? m[1] || m[0] : null
}

function adminLabel(from) {
  if (!from) return 'Support'
  if (from.username) return `@${from.username}`
  return from.first_name || `Admin ${from.id}`
}

async function deliverReply(sessionId, text, from, chatId) {
  const result = appendAdminMessage(sessionId, text, adminLabel(from))
  clearPending(from.id)
  if (!result.ok) {
    await send(chatId, `⚠️ Failed: ${result.error}`)
    return false
  }
  await send(
    chatId,
    `✅ Reply delivered to site chat\nSession: <code>${esc(sessionId)}</code>\n\n${esc(text.slice(0, 500))}`
  )
  // quietly notify other admin(s) / group that it was answered
  const note = `✅ <b>${esc(adminLabel(from))}</b> replied to <code>${esc(sessionId)}</code>`
  for (const id of [...ADMIN_IDS, Number(GROUP_ID)]) {
    if (Number(id) === Number(chatId) || Number(id) === Number(from.id)) continue
    await send(id, note).catch(() => {})
  }
  return true
}

async function enterReplyMode(chatId, adminId, sessionId) {
  if (!getSession(sessionId)) {
    await send(chatId, '⚠️ Session not found (may have expired on the site).')
    return
  }
  setPending(adminId, sessionId)
  await send(
    chatId,
    `✍️ <b>Reply mode ON</b>\nSession: <code>${esc(sessionId)}</code>\n\nType your answer now.\n/cancel to abort.`,
    {
      reply_markup: {
        force_reply: true,
        selective: true,
        input_field_placeholder: 'Type admin reply…'
      }
    }
  )
}

async function showHistory(chatId, sessionId) {
  const session = getSession(sessionId)
  if (!session) {
    await send(chatId, '⚠️ Session not found.')
    return
  }
  const lines = session.messages
    .filter(m => m.role !== 'system')
    .slice(-12)
    .map(m => {
      const who = m.role === 'user' ? '👤 User' : `🛡 ${m.adminName || 'Admin'}`
      return `${who}: ${esc(m.text)}`
    })
  await send(
    chatId,
    `📋 <b>History</b> <code>${esc(sessionId)}</code>\n\n${lines.join('\n\n') || '(empty)'}`
  )
}

async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id
  const data = cb.data || ''
  const from = cb.from
  await tg('answerCallbackQuery', { callback_query_id: cb.id })

  if (!chatId || !isAdmin(from?.id)) {
    if (chatId) await send(chatId, '⛔ Not authorized.')
    return
  }

  if (data.startsWith('reply:')) {
    await enterReplyMode(chatId, from.id, data.slice(6))
    return
  }
  if (data.startsWith('hist:')) {
    await showHistory(chatId, data.slice(5))
  }
}

async function handleMessage(msg) {
  let text = (msg.text || '').trim()
  if (!text || !msg.from) return

  const chatId = msg.chat.id
  const from = msg.from
  const isPrivate = msg.chat.type === 'private'

  // Strip @botname from group commands: /reply@bot ...
  if (text.startsWith('/')) {
    text = text.replace(/^\/([a-zA-Z0-9_]+)@[A-Za-z0-9_]+/, '/$1')
  }

  // Ignore plain group chatter
  if (!isPrivate && !text.startsWith('/') && !msg.reply_to_message) return

  if (!isAdmin(from.id)) {
    if (isPrivate) await send(chatId, 'This bot is for THORSwap support admins only.')
    return
  }

  if (text === '/start' || text === '/help') {
    await send(
      chatId,
      `🟢 <b>THORSwap Support Bot</b> — online\n\n` +
        `When a visitor chats on the site you get a notification.\n\n` +
        `<b>Reply (any of these):</b>\n` +
        `1. Tap <b>Reply</b> under the alert, then type\n` +
        `2. Swipe-reply on the alert message, then type\n` +
        `3. <code>/reply SESSION_ID your message</code>\n\n` +
        `<b>Other</b>\n` +
        `/pending — recent chats\n` +
        `/cancel — leave reply mode\n` +
        `/help`
    )
    return
  }

  if (text === '/cancel') {
    clearPending(from.id)
    await send(chatId, 'Cancelled reply mode.')
    return
  }

  if (text === '/pending' || text.startsWith('/pending ')) {
    const recent = listRecent(10)
    if (!recent.length) {
      await send(chatId, 'No chat sessions yet.')
      return
    }
    const lines = recent.map(s => {
      const last = [...s.messages].reverse().find(m => m.role === 'user')
      return (
        `• <code>${esc(s.id)}</code> — ${esc(s.userLabel)}\n` +
        `  ${esc((last?.text || '').slice(0, 80) || '(no msg)')}`
      )
    })
    await send(chatId, `📬 <b>Recent chats</b>\n\n${lines.join('\n\n')}`)
    return
  }

  if (text.startsWith('/reply ')) {
    const rest = text.slice(7).trim()
    const sp = rest.indexOf(' ')
    if (sp <= 0) {
      await send(chatId, 'Usage: <code>/reply SESSION_ID your message</code>')
      return
    }
    await deliverReply(rest.slice(0, sp).trim(), rest.slice(sp + 1).trim(), from, chatId)
    return
  }

  // Telegram native swipe-reply on a support notification → extract session id
  if (msg.reply_to_message) {
    const sid =
      extractSessionId(msg.reply_to_message.text) ||
      extractSessionId(msg.reply_to_message.caption)
    if (sid) {
      await deliverReply(sid, text, from, chatId)
      return
    }
  }

  // Pending typed reply after tapping Reply button / force_reply
  const pending = getPending(from.id)
  if (pending?.mode === 'awaiting_reply') {
    await deliverReply(pending.sessionId, text, from, chatId)
    return
  }

  if (isPrivate) {
    await send(
      chatId,
      'No active reply mode.\nTap <b>Reply</b> on a chat alert, swipe-reply it, or use /pending.\n/help'
    )
  }
}

async function handleUpdate(update) {
  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query)
      return
    }
    if (update.message) {
      await handleMessage(update.message)
    }
  } catch (err) {
    console.error('[bot] update error:', err)
  }
}

async function loop() {
  console.log('[bot] THORSwap support bot starting (standalone store mode)')
  console.log('[bot] Store:', STORE_PATH)
  console.log('[bot] Admins:', ADMIN_IDS.join(', '))

  try {
    await tg('deleteWebhook', { drop_pending_updates: false })
  } catch (e) {
    console.warn('[bot] deleteWebhook:', e.message)
  }

  const me = await tg('getMe')
  if (!me?.ok) {
    console.error('[bot] getMe failed — check TELEGRAM_BOT_TOKEN', me)
    process.exit(1)
  }
  console.log(`[bot] Logged in as @${me.result.username} — listening…`)

  while (running) {
    try {
      const data = await tg('getUpdates', {
        offset,
        timeout: 25,
        allowed_updates: ['message', 'callback_query']
      })
      if (!data?.ok) {
        console.error('[bot] getUpdates error:', data?.description)
        await sleep(3000)
        continue
      }
      for (const update of data.result || []) {
        offset = update.update_id + 1
        await handleUpdate(update)
      }
    } catch (e) {
      console.error('[bot] loop error:', e.message)
      await sleep(3000)
    }
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

process.on('SIGINT', () => {
  running = false
  console.log('[bot] stopping…')
  process.exit(0)
})
process.on('SIGTERM', () => {
  running = false
  process.exit(0)
})

loop()
