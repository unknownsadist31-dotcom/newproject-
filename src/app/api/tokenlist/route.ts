import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

let cached: object | null = null

export async function GET() {
  if (!cached) {
    const filePath = path.join(process.cwd(), 'public', 'data', 'tokenlist.json')
    const raw = await readFile(filePath, 'utf-8')
    cached = JSON.parse(raw)
  }
  return NextResponse.json(cached, {
    headers: {
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
