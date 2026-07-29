#!/usr/bin/env node
/**
 * Register Telegram webhook to this site (HTTPS public URL required by Telegram).
 *
 *   SITE_URL=https://your-domain.com TELEGRAM_WEBHOOK_SECRET=somesecret node tools/set-telegram-webhook.mjs
 *
 * Prefer `npm run bot` (long poll) if you don't want/need a public webhook.
 */
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8140825280:AAEd2TDo2fgZv_bDEfu7wNggxHrD7jHdr8g'
const SITE = (process.env.SITE_URL || '').replace(/\/$/, '')
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ''

if (!SITE || !SITE.startsWith('https://')) {
  console.error('Set SITE_URL to your public https origin, e.g. https://swap.example.com')
  process.exit(1)
}

const url = SECRET
  ? `${SITE}/api/telegram/webhook?secret=${encodeURIComponent(SECRET)}`
  : `${SITE}/api/telegram/webhook`

const body = {
  url,
  allowed_updates: ['message', 'callback_query'],
  drop_pending_updates: false
}
if (SECRET) body.secret_token = SECRET

const res = await fetch(`https://api.telegram.org/bot${TOKEN}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
})
const data = await res.json()
console.log(JSON.stringify(data, null, 2))
if (!data.ok) process.exit(1)
console.log('Webhook set to', url)
