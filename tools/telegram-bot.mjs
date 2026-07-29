#!/usr/bin/env node
/**
 * Companion Telegram long-poller for THORSwap support chat.
 *
 * Use this when you cannot (or prefer not to) set a Telegram webhook.
 * Runs alongside the Next.js server on the same host:
 *
 *   # Terminal 1
 *   npm run start
 *   # Terminal 2
 *   npm run bot
 *
 * Or under systemd / pm2 / docker compose with two processes.
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN   — bot token
 *   SITE_URL             — e.g. http://127.0.0.1:3000 (default)
 *   TELEGRAM_WEBHOOK_SECRET — if set on the site, forwarded as secret header
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8140825280:AAEd2TDo2fgZv_bDEfu7wNggxHrD7jHdr8g'
const SITE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://127.0.0.1:3000').replace(
  /\/$/,
  ''
)
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ''
const API = `https://api.telegram.org/bot${TOKEN}`

let offset = 0
let running = true

async function tg(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  })
  return res.json()
}

async function forward(update) {
  const headers = { 'Content-Type': 'application/json' }
  if (SECRET) headers['x-telegram-bot-api-secret-token'] = SECRET
  const res = await fetch(`${SITE_URL}/api/telegram/webhook`, {
    method: 'POST',
    headers,
    body: JSON.stringify(update)
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    console.error(`[bot] forward failed ${res.status}: ${t.slice(0, 200)}`)
  }
}

async function loop() {
  console.log(`[bot] THORSwap support bot starting`)
  console.log(`[bot] Forwarding updates → ${SITE_URL}/api/telegram/webhook`)

  // Drop webhook so getUpdates works
  try {
    await tg('deleteWebhook', { drop_pending_updates: false })
  } catch (e) {
    console.warn('[bot] deleteWebhook:', e.message)
  }

  const me = await tg('getMe')
  if (me?.ok) console.log(`[bot] Logged in as @${me.result.username}`)
  else {
    console.error('[bot] getMe failed — check TELEGRAM_BOT_TOKEN', me)
    process.exit(1)
  }

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
        try {
          await forward(update)
        } catch (e) {
          console.error('[bot] forward error:', e.message)
        }
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
