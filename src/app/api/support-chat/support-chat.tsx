'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageCircle, Send, X, Headphones } from 'lucide-react'
import { cn } from '@/lib/utils'

type ChatRole = 'user' | 'admin' | 'system'

interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  ts: number
  adminName?: string
}

interface ChatSessionPayload {
  id: string
  messages: ChatMessage[]
}

const STORAGE_KEY = 'thorswap_support_session'

function formatTime(ts: number) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function SupportChat() {
  const [open, setOpen] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [starting, setStarting] = useState(false)
  const [unread, setUnread] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const lastAdminMsgRef = useRef<string>('')
  const openRef = useRef(open)
  const sseRef = useRef<EventSource | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)
  openRef.current = open

  const scrollBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = listRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }, [])

  const applySession = useCallback(
    (data: ChatSessionPayload) => {
      setSessionId(data.id)
      try {
        localStorage.setItem(STORAGE_KEY, data.id)
      } catch {
        /* ignore */
      }
      setMessages(data.messages)

      const lastAdmin = [...data.messages].reverse().find(m => m.role === 'admin')
      if (lastAdmin && lastAdmin.id !== lastAdminMsgRef.current) {
        if (!openRef.current && lastAdminMsgRef.current) {
          setUnread(u => u + 1)
        }
        lastAdminMsgRef.current = lastAdmin.id
      }
      scrollBottom()
    },
    [scrollBottom]
  )

  const startSession = useCallback(async () => {
    setStarting(true)
    setError(null)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          pageUrl: typeof window !== 'undefined' ? window.location.href : undefined
        })
      })
      if (!res.ok) throw new Error('Failed to start chat')
      const data = (await res.json()) as ChatSessionPayload
      applySession(data)
    } catch {
      setError('Could not start chat. Try again.')
    } finally {
      setStarting(false)
    }
  }, [applySession])

  // Restore session on mount
  useEffect(() => {
    mountedRef.current = true
    let cancelled = false
    ;(async () => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (!saved) return
        const res = await fetch(`/api/chat?sessionId=${encodeURIComponent(saved)}&_t=${Date.now()}`, {
          cache: 'no-store'
        })
        if (!res.ok) {
          localStorage.removeItem(STORAGE_KEY)
          return
        }
        const data = (await res.json()) as ChatSessionPayload
        if (!cancelled && mountedRef.current) applySession(data)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
      mountedRef.current = false
    }
  }, [applySession])

  // SSE + polling fallback for real-time updates
  useEffect(() => {
    if (!sessionId) return

    // Cleanup previous connections
    const cleanup = () => {
      if (sseRef.current) {
        sseRef.current.close()
        sseRef.current = null
      }
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
    cleanup()

    let active = true

    // Try SSE first
    const connectSSE = () => {
      try {
        const es = new EventSource(`/api/chat/stream?sessionId=${encodeURIComponent(sessionId)}`)
        sseRef.current = es

        es.onmessage = (event) => {
          if (!active) return
          try {
            const data = JSON.parse(event.data) as ChatSessionPayload
            if (data.error) {
              // Session expired, fall back to polling
              es.close()
              sseRef.current = null
              startPolling()
              return
            }
            setMessages(data.messages)
            const lastAdmin = [...data.messages].reverse().find(m => m.role === 'admin')
            if (lastAdmin && lastAdmin.id !== lastAdminMsgRef.current) {
              if (!openRef.current && lastAdminMsgRef.current) {
                setUnread(u => u + 1)
              }
              lastAdminMsgRef.current = lastAdmin.id
            }
          } catch {
            /* ignore parse errors */
          }
        }

        es.onerror = () => {
          // SSE failed, fall back to polling
          es.close()
          sseRef.current = null
          if (active) startPolling()
        }
      } catch {
        // SSE not supported, use polling
        if (active) startPolling()
      }
    }

    const startPolling = () => {
      if (pollRef.current) return
      const poll = async () => {
        if (!active) return
        try {
          const res = await fetch(
            `/api/chat?sessionId=${encodeURIComponent(sessionId!)}&_t=${Date.now()}`,
            { cache: 'no-store' }
          )
          if (!res.ok || !active) return
          const data = (await res.json()) as ChatSessionPayload
          if (active) applySession(data)
        } catch {
          /* ignore */
        }
      }

      const ms = open ? 2000 : 8000
      poll()
      pollRef.current = setInterval(poll, ms)
    }

    connectSSE()

    return () => {
      active = false
      cleanup()
    }
  }, [sessionId, open, applySession])

  useEffect(() => {
    if (open) {
      setUnread(0)
      scrollBottom()
    }
  }, [open, scrollBottom])

  const onOpen = async () => {
    setOpen(true)
    setUnread(0)
    if (!sessionId && !starting) {
      await startSession()
    }
  }

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    setError(null)
    setInput('')

    try {
      let sid = sessionId
      if (!sid) {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'start',
            pageUrl: typeof window !== 'undefined' ? window.location.href : undefined
          })
        })
        if (!res.ok) throw new Error('start failed')
        const data = (await res.json()) as ChatSessionPayload
        applySession(data)
        sid = data.id
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', sessionId: sid, text })
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error || 'send failed')
      }
      const data = (await res.json()) as ChatSessionPayload
      applySession(data)
    } catch {
      setError('Failed to send. Please try again.')
      setInput(text)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="pointer-events-none fixed right-3 bottom-3 z-[90] flex flex-col items-end gap-3 sm:right-6 sm:bottom-24 md:bottom-24">
      {/* Panel */}
      {open && (
        <div
          className={cn(
            'pointer-events-auto flex w-[min(100vw-2rem,380px)] flex-col overflow-hidden',
            'rounded-20 border border-stroke-menu bg-modal shadow-2xl',
            'h-[min(70vh,520px)] animate-in fade-in zoom-in-95 duration-200'
          )}
        >
          {/* Header */}
          <div className="flex items-center gap-3 bg-green-default px-4 py-3 text-txt-green-default">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-black/15">
              <Headphones size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold tracking-wide">THORSwap Support</div>
              <div className="truncate text-xs opacity-80">Admins typically reply within minutes</div>
            </div>
            <button
              type="button"
              aria-label="Close chat"
              onClick={() => setOpen(false)}
              className="rounded-full p-1.5 transition-opacity hover:opacity-70"
            >
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto bg-swap-global px-3 py-3">
            {starting && messages.length === 0 && (
              <div className="py-8 text-center text-sm text-txt-med-contrast">Starting chat…</div>
            )}
            {messages.map(m => (
              <div
                key={m.id}
                className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[85%] rounded-15 px-3 py-2 text-sm leading-snug break-words shadow-sm',
                    m.role === 'user' && 'bg-green-default text-txt-green-default',
                    m.role === 'admin' && 'border border-stroke-low-contrast bg-sub-container-modal text-txt-high-contrast',
                    m.role === 'system' && 'border border-dashed border-stroke-menu bg-btn-small-default/40 text-txt-med-contrast'
                  )}
                >
                  {m.role === 'admin' && (
                    <div className="mb-0.5 text-[10px] font-semibold tracking-wide text-green-contrast uppercase">
                      {m.adminName || 'Support'}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap">{m.text}</div>
                  <div
                    className={cn(
                      'mt-1 text-[10px] opacity-60',
                      m.role === 'user' ? 'text-right' : 'text-left'
                    )}
                  >
                    {formatTime(m.ts)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {error && (
            <div className="bg-error/10 px-3 py-1.5 text-center text-xs text-error">{error}</div>
          )}

          {/* Composer */}
          <div className="border-t border-stroke-menu bg-modal p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                rows={1}
                maxLength={2000}
                placeholder="Type your message…"
                className={cn(
                  'max-h-28 min-h-10 flex-1 resize-none rounded-15 border border-stroke-low-contrast',
                  'bg-input-modal-bg px-3 py-2.5 text-sm text-input-modal-text-high outline-none',
                  'placeholder:text-input-modal-text-low focus:border-input-modal-border-active focus:bg-input-modal-bg-active'
                )}
              />
              <button
                type="button"
                disabled={sending || !input.trim()}
                onClick={() => void send()}
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                  'bg-green-default text-txt-green-default transition-opacity',
                  'hover:opacity-90 disabled:pointer-events-none disabled:opacity-40'
                )}
                aria-label="Send message"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Launcher */}
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : void onOpen())}
        className={cn(
          'pointer-events-auto relative flex h-12 w-12 items-center justify-center rounded-full sm:h-14 sm:w-14',
          'bg-green-default text-txt-green-default shadow-lg transition-transform',
          'hover:scale-105 hover:opacity-95 active:scale-95'
        )}
        aria-label={open ? 'Close support chat' : 'Open support chat'}
      >
        {open ? <X size={24} /> : <MessageCircle size={24} />}
        {!open && unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    </div>
  )
}
