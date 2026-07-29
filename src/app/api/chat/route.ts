import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { appendMessage, createSession, getSession } from '@/lib/support-chat-store'
import { notifyNewUserMessage } from '@/lib/support-chat-bot'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SESSION_ID_RE = /^sess_[a-z0-9]+_[a-z0-9]+$/i

function publicSession(sessionId: string) {
  const session = getSession(sessionId)
  if (!session) return null
  return {
    id: session.id,
    messages: session.messages.map(m => ({
      id: m.id,
      role: m.role,
      text: m.text,
      ts: m.ts,
      adminName: m.adminName
    }))
  }
}

/** Poll messages for an existing session */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId') || ''
  if (!SESSION_ID_RE.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 400 })
  }
  const session = publicSession(sessionId)
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }
  return NextResponse.json(session, {
    headers: { 'Cache-Control': 'no-store' }
  })
}

/**
 * POST body:
 *  - { action: 'start', pageUrl?, userLabel? } → create session
 *  - { action: 'send', sessionId, text } → user message → Telegram admins
 */
export async function POST(req: NextRequest) {
  const retryAfter = rateLimit(req, 'support-chat', 30)
  if (retryAfter !== null) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  let body: {
    action?: string
    sessionId?: string
    text?: string
    pageUrl?: string
    userLabel?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = body.action || 'send'

  if (action === 'start') {
    const ua = req.headers.get('user-agent') || undefined
    const session = createSession({
      userLabel: typeof body.userLabel === 'string' ? body.userLabel.slice(0, 64) : undefined,
      userAgent: ua?.slice(0, 240),
      pageUrl: typeof body.pageUrl === 'string' ? body.pageUrl.slice(0, 500) : undefined
    })
    return NextResponse.json(publicSession(session.id))
  }

  if (action === 'send') {
    const sessionId = body.sessionId || ''
    const text = typeof body.text === 'string' ? body.text : ''
    if (!SESSION_ID_RE.test(sessionId)) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 400 })
    }
    if (!text.trim() || text.length > 2000) {
      return NextResponse.json({ error: 'Message required (max 2000 chars)' }, { status: 400 })
    }
    if (!getSession(sessionId)) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const msg = appendMessage(sessionId, 'user', text)
    if (!msg) {
      return NextResponse.json({ error: 'Failed to save message' }, { status: 500 })
    }

    // Auto ack so the visitor sees something immediately
    appendMessage(
      sessionId,
      'system',
      'Message received — an admin will reply shortly.'
    )

    // Fire-and-forget Telegram notify
    void notifyNewUserMessage(sessionId, text.trim()).catch(err =>
      console.error('[chat] telegram notify failed:', err)
    )

    return NextResponse.json(publicSession(sessionId))
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
