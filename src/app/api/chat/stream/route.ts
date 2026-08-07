import { NextRequest } from 'next/server'
import { getSession } from '@/lib/support-chat-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SESSION_ID_RE = /^sess_[a-z0-9]+_[a-z0-9]+$/i

/**
 * Server-Sent Events endpoint for real-time chat updates.
 *
 * The client connects and the server pushes the full session snapshot
 * whenever messages change. Falls back to polling every 2s.
 *
 * Usage: GET /api/chat/stream?sessionId=sess_xxx
 */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId') || ''

  if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
    return new Response('Invalid sessionId', { status: 400 })
  }

  const session = getSession(sessionId)
  if (!session) {
    return new Response('Session not found', { status: 404 })
  }

  let lastMsgCount = session.messages.length
  let closed = false
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const sendSnapshot = () => {
        if (closed) return
        const s = getSession(sessionId)
        if (!s) {
          const data = JSON.stringify({ error: 'Session expired' })
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
          return
        }
        const payload = {
          id: s.id,
          messages: s.messages.map(m => ({
            id: m.id,
            role: m.role,
            text: m.text,
            ts: m.ts,
            adminName: m.adminName,
          })),
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      // Send initial snapshot
      sendSnapshot()

      // Poll for changes every 2s
      const interval = setInterval(() => {
        const s = getSession(sessionId)
        if (!s) {
          sendSnapshot()
          clearInterval(interval)
          controller.close()
          return
        }
        if (s.messages.length !== lastMsgCount) {
          lastMsgCount = s.messages.length
          sendSnapshot()
        } else {
          // Send a keepalive comment
          controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`))
        }
      }, 2000)

      req.signal.addEventListener('abort', () => {
        closed = true
        clearInterval(interval)
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
