import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'fs'
import path from 'path'

export type ChatRole = 'user' | 'admin' | 'system'

export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  ts: number
  adminName?: string
}

export interface ChatSession {
  id: string
  createdAt: number
  updatedAt: number
  userLabel: string
  userAgent?: string
  pageUrl?: string
  messages: ChatMessage[]
}

interface AdminPending {
  mode: 'awaiting_reply'
  sessionId: string
  since: number
}

interface StoreData {
  sessions: Record<string, ChatSession>
  adminPending: Record<string, AdminPending>
}

const DATA_DIR = process.env.CHAT_STORE_DIR
  ? path.resolve(process.env.CHAT_STORE_DIR)
  : path.join(process.cwd(), 'data')
const STORE_PATH = process.env.CHAT_STORE_PATH
  ? path.resolve(process.env.CHAT_STORE_PATH)
  : path.join(DATA_DIR, 'support-chats.json')
const MAX_SESSIONS = 500
const MAX_MESSAGES = 200
const WELCOME =
  'Hi! Send a message and a THORSwap support admin will reply shortly.'

function emptyStore(): StoreData {
  return { sessions: {}, adminPending: {} }
}

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

function readStore(): StoreData {
  try {
    ensureDir()
    if (!existsSync(STORE_PATH)) return emptyStore()
    const raw = readFileSync(STORE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as StoreData
    if (!parsed.sessions) parsed.sessions = {}
    if (!parsed.adminPending) parsed.adminPending = {}
    return parsed
  } catch {
    return emptyStore()
  }
}

function writeStore(data: StoreData) {
  ensureDir()
  const tmp = `${STORE_PATH}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data), 'utf8')
  renameSync(tmp, STORE_PATH)
}

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function prune(data: StoreData) {
  const ids = Object.keys(data.sessions)
  if (ids.length <= MAX_SESSIONS) return
  const sorted = ids
    .map(id => data.sessions[id])
    .sort((a, b) => a.updatedAt - b.updatedAt)
  const drop = sorted.slice(0, ids.length - MAX_SESSIONS)
  for (const s of drop) delete data.sessions[s.id]
}

export function createSession(meta?: { userLabel?: string; userAgent?: string; pageUrl?: string }): ChatSession {
  const data = readStore()
  const id = uid('sess')
  const now = Date.now()
  const session: ChatSession = {
    id,
    createdAt: now,
    updatedAt: now,
    userLabel: meta?.userLabel || `Guest-${id.slice(-6).toUpperCase()}`,
    userAgent: meta?.userAgent,
    pageUrl: meta?.pageUrl,
    messages: [
      {
        id: uid('msg'),
        role: 'system',
        text: WELCOME,
        ts: now
      }
    ]
  }
  data.sessions[id] = session
  prune(data)
  writeStore(data)
  return session
}

export function getSession(sessionId: string): ChatSession | null {
  if (!sessionId) return null
  const data = readStore()
  return data.sessions[sessionId] || null
}

export function appendMessage(
  sessionId: string,
  role: ChatRole,
  text: string,
  adminName?: string
): ChatMessage | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 4000) return null

  const data = readStore()
  const session = data.sessions[sessionId]
  if (!session) return null

  const msg: ChatMessage = {
    id: uid('msg'),
    role,
    text: trimmed,
    ts: Date.now(),
    ...(adminName ? { adminName } : {})
  }
  session.messages.push(msg)
  if (session.messages.length > MAX_MESSAGES) {
    session.messages = session.messages.slice(-MAX_MESSAGES)
  }
  session.updatedAt = msg.ts
  writeStore(data)
  return msg
}

export function setAdminPending(adminId: number | string, sessionId: string) {
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

export function clearAdminPending(adminId: number | string) {
  const data = readStore()
  delete data.adminPending[String(adminId)]
  writeStore(data)
}

export function getAdminPending(adminId: number | string): AdminPending | null {
  const data = readStore()
  return data.adminPending[String(adminId)] || null
}

export function listRecentSessions(limit = 15): ChatSession[] {
  const data = readStore()
  return Object.values(data.sessions)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
}
