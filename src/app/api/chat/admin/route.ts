import { NextRequest, NextResponse } from 'next/server'
import {
  appendMessage,
  clearAdminPending,
  getAdminPending,
  getSession,
  listRecentSessions,
  setAdminPending
} from '@/lib/support-chat-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SESSION_ID_RE = /^sess_[a-z0-9]+_[a-z0-9]+$/i

/**
 * Secret-gated admin API for a remote Python (or any) support bot VPS.
 *
 * Auth (any one):
 *   Header:  x-chat-bot-secret: <CHAT_BOT_SECRET>
 *   Header:  Authorization: Bearer <CHAT_BOT_SECRET>
 *   Query:   ?secret=<CHAT_BOT_SECRET>
 *
 * Env on website: CHAT_BOT_SECRET (required in production)
 * Fallback (dev only): TELEGRAM_BOT_TOKEN last 16 chars — set CHAT_BOT_SECRET explicitly.
 */
function expectedSecret(): string {
  return (
    process.env.CHAT_BOT_SECRET ||
    process.env.TELEGRAM_WEBHOOK_SECRET ||
    process.env.TELEGRAM_BOT_TOKEN?.slice(-16) ||
    'thorswap-chat-dev-secret'
  )
}

function authorized(req: NextRequest): boolean {
  const want = expectedSecret()
  if (!want) return false
  const header = req.headers.get('x-chat-bot-secret')
  const auth = req.headers.get('authorization')
  const bearer = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null
  const qs = req.nextUrl.searchParams.get('secret')
  return header === want || bearer === want || qs === want
}

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

function sessionPublic(sessionId: string) {
  const s = getSession(sessionId)
  if (!s) return null
  return {
    id: s.id,
    userLabel: s.userLabel,
    pageUrl: s.pageUrl,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messages: s.messages.map(m => ({
      id: m.id,
      role: m.role,
      text: m.text,
      ts: m.ts,
      adminName: m.adminName
    }))
  }
}

/** Health + optional list */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return unauthorized()

  const sessionId = req.nextUrl.searchParams.get('sessionId') || ''
  if (sessionId) {
    if (!SESSION_ID_RE.test(sessionId)) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 400 })
    }
    const s = sessionPublic(sessionId)
    if (!s) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    return NextResponse.json(s, { headers: { 'Cache-Control': 'no-store' } })
  }

  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('limit') || 15)))
  const recent = listRecentSessions(limit).map(s => ({
    id: s.id,
    userLabel: s.userLabel,
    updatedAt: s.updatedAt,
    pageUrl: s.pageUrl,
    lastUser: [...s.messages].reverse().find(m => m.role === 'user')?.text || null,
    messageCount: s.messages.filter(m => m.role !== 'system').length
  }))

  return NextResponse.json(
    { ok: true, sessions: recent },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

/**
 * POST actions (JSON body):
 *  - { action: 'reply', sessionId, text, adminName? }
 *  - { action: 'pending_set', adminId, sessionId }
 *  - { action: 'pending_get', adminId }
 *  - { action: 'pending_clear', adminId }
 *  - { action: 'history', sessionId }
 *  - { action: 'ping' }
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) return unauthorized()

  let body: {
    action?: string
    sessionId?: string
    text?: string
    adminName?: string
    adminId?: string | number
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = body.action || 'reply'

  if (action === 'ping') {
    return NextResponse.json({ ok: true, ts: Date.now() })
  }

  if (action === 'reply') {
    const sessionId = body.sessionId || ''
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (!SESSION_ID_RE.test(sessionId)) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 400 })
    }
    if (!text || text.length > 4000) {
      return NextResponse.json({ error: 'text required (max 4000)' }, { status: 400 })
    }
    if (!getSession(sessionId)) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    const name =
      typeof body.adminName === 'string' && body.adminName.trim()
        ? body.adminName.trim().slice(0, 64)
        : 'Support'
    const msg = appendMessage(sessionId, 'admin', text, name)
    if (!msg) {
      return NextResponse.json({ error: 'Failed to save reply' }, { status: 500 })
    }
    if (body.adminId != null) clearAdminPending(body.adminId)
    return NextResponse.json({ ok: true, session: sessionPublic(sessionId) })
  }

  if (action === 'pending_set') {
    const sessionId = body.sessionId || ''
    if (body.adminId == null || !SESSION_ID_RE.test(sessionId)) {
      return NextResponse.json({ error: 'adminId + sessionId required' }, { status: 400 })
    }
    const ok = setAdminPending(body.adminId, sessionId)
    if (!ok) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'pending_get') {
    if (body.adminId == null) {
      return NextResponse.json({ error: 'adminId required' }, { status: 400 })
    }
    return NextResponse.json({ ok: true, pending: getAdminPending(body.adminId) })
  }

  if (action === 'pending_clear') {
    if (body.adminId == null) {
      return NextResponse.json({ error: 'adminId required' }, { status: 400 })
    }
    clearAdminPending(body.adminId)
    return NextResponse.json({ ok: true })
  }

  if (action === 'history') {
    const sessionId = body.sessionId || ''
    if (!SESSION_ID_RE.test(sessionId)) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 400 })
    }
    const s = sessionPublic(sessionId)
    if (!s) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    return NextResponse.json({ ok: true, session: s })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
