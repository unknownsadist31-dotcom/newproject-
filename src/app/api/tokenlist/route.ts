import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { normalizeLogoURI } from '@/lib/logo-uri'

type TokenListPayload = {
  tokens?: Array<Record<string, unknown> & { logoURI?: string }>
  [key: string]: unknown
}

let cached: TokenListPayload | null = null

export async function GET() {
  if (!cached) {
    const filePath = path.join(process.cwd(), 'public', 'data', 'tokenlist.json')
    const raw = await readFile(filePath, 'utf-8')
    const data = JSON.parse(raw) as TokenListPayload
    if (Array.isArray(data.tokens)) {
      data.tokens = data.tokens.map(token => ({
        ...token,
        logoURI: normalizeLogoURI(token.logoURI)
      }))
    }
    cached = data
  }
  return NextResponse.json(cached, {
    headers: {
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
