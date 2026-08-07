import { NextRequest, NextResponse } from 'next/server'
import {
  appendMessage,
  createSession,
  getSession
} from '@/lib/support-chat-store'
import { notifyNewUserMessage } from '@/lib/support-chat-bot'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// If an external bot handles Telegram, skip site-side notifications
const externalBot = !!(process.env.CHAT_BOT_SECRET)

const SESSION_ID_RE = /^sess_[a-z0-9]+_[a-z0-9]+$/i

function sessionPublic(sessionId: string) {
  const s = getSession(sessionId)
  if (!s) return null
  return {
    id: s.id,
    messages: s.messages.map(m => ({
      id: m.id,
      role: m.role,
      text: m.text,
      ts: m.ts,
      adminName: m.adminName
    }))
  }
}

/** GET — poll for session updates */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId') || ''
  if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const s = sessionPublic(sessionId)
  if (!s) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  return NextResponse.json(s, {
    headers: { 'Cache-Control': 'no-store, must-revalidate' }
  })
}

/** POST — start session or send message */
export async function POST(req: NextRequest) {
  let body: {
    action?: string
    sessionId?: string
    text?: string
    pageUrl?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = body.action || 'send'

  // Create new session
  if (action === 'start') {
    const userAgent = req.headers.get('user-agent') || undefined
    const session = createSession({
      userLabel: undefined,
      userAgent,
      pageUrl: body.pageUrl
    })
    return NextResponse.json({
      id: session.id,
      messages: session.messages.map(m => ({
        id: m.id,
        role: m.role,
        text: m.text,
        ts: m.ts,
        adminName: m.adminName
      }))
    })
  }

  // Send user message
  if (action === 'send') {
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

    const msg = appendMessage(sessionId, 'user', text)
    if (!msg) {
      return NextResponse.json({ error: 'Failed to save message' }, { status: 500 })
    }

    // Telegram notification: skip if external Python bot handles it
    if (!externalBot) {
      notifyNewUserMessage(sessionId, text).catch(err =>
        console.error('[chat] notify error:', err)
      )
    }

    return NextResponse.json(sessionPublic(sessionId))
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
