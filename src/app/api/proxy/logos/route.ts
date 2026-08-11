import { NextRequest, NextResponse } from 'next/server'

const LOGO_CDN = 'https://storage.googleapis.com/token-list-swapkit'

export async function GET(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  if (!path?.length) {
    return NextResponse.json({ error: 'Missing logo path' }, { status: 400 })
  }

  // Prevent path traversal
  if (path.some(segment => segment === '..' || segment.includes('\\'))) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  const targetUrl = `${LOGO_CDN}/${path.map(encodeURIComponent).join('/')}`

  try {
    const res = await fetch(targetUrl, {
      // logos rarely change
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
