import { NextRequest, NextResponse } from 'next/server'
import { handleTelegramUpdate, type TgUpdate } from '@/lib/support-chat-bot'
import { TELEGRAM_BOT_TOKEN } from '@/lib/telegram'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Telegram webhook endpoint.
 * Optionally protect with ?secret= or header x-telegram-bot-api-secret-token
 * matching TELEGRAM_WEBHOOK_SECRET env.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (secret) {
    const header = req.headers.get('x-telegram-bot-api-secret-token')
    const qs = req.nextUrl.searchParams.get('secret')
    if (header !== secret && qs !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let update: TgUpdate
  try {
    update = (await req.json()) as TgUpdate
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Always 200 quickly so Telegram doesn't retry storms
  try {
    await handleTelegramUpdate(update)
  } catch (err) {
    console.error('[telegram/webhook]', err)
  }

  return NextResponse.json({ ok: true })
}

/** Health / identity check — no secrets leaked. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    bot: TELEGRAM_BOT_TOKEN ? `…${TELEGRAM_BOT_TOKEN.slice(-6)}` : null,
    mode: 'webhook'
  })
}
