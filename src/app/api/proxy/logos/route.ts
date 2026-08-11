import { NextRequest, NextResponse } from 'next/server'

const LOGO_CDN = 'https://storage.googleapis.com/token-list-swapkit'

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('path')
  if (!raw) {
    return NextResponse.json({ error: 'Missing logo path' }, { status: 400 })
  }

  // Decode once, then split — blocks traversal
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  const segments = decoded.split('/').filter(Boolean)
  if (!segments.length || segments.some(s => s === '..' || s.includes('\\') || s.includes('\0'))) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  const targetUrl = `${LOGO_CDN}/${segments.map(encodeURIComponent).join('/')}`

  try {
    const res = await fetch(targetUrl, {
      next: { revalidate: 86400 },
      headers: { Accept: 'image/*' }
    })

    if (!res.ok) {
      return new NextResponse(null, { status: res.status })
    }

    const contentType = res.headers.get('content-type') || 'image/png'
    const buffer = await res.arrayBuffer()

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
        'Access-Control-Allow-Origin': '*'
      }
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch logo' }, { status: 502 })
  }
}
