import { NextRequest, NextResponse } from 'next/server'

const PROXY_TARGETS: Record<string, string> = {
  thorswap: 'https://api.thorswap.net',
  thorchain: 'https://api.thorchain.org',
  'lq-thornode': 'https://gateway.liquify.com/chain/thorchain_api',
  'lq-midgard': 'https://gateway.liquify.com/chain/thorchain_midgard',
  mayamidgard: 'https://midgard.mayachain.info',
  mayanode: 'https://mayanode.mayachain.info',
  dexscreener: 'https://api.dexscreener.com',
}

function buildTargetUrl(pathParts: string[], search: string): { url: string; prefix: string } | null {
  const prefix = pathParts[0]
  const targetBase = PROXY_TARGETS[prefix]
  if (!targetBase) return null
  const targetPath = '/' + pathParts.slice(1).join('/')
  return { url: `${targetBase}${targetPath}${search}`, prefix }
}

async function proxyRequest(req: NextRequest) {
  const url = new URL(req.url)
  const pathParts = url.pathname.replace('/api/proxy/', '').split('/')
  const target = buildTargetUrl(pathParts, url.search)
  if (!target) {
    return NextResponse.json({ error: 'Unknown proxy target' }, { status: 400 })
  }

  const headers: Record<string, string> = {}
  if (target.prefix === 'thorswap') {
    headers['Referer'] = 'thorswap-ui'
  }
  headers['Content-Type'] = req.headers.get('content-type') || 'application/json'

  const method = req.method
  const fetchOptions: RequestInit = {
    method,
    headers,
  }

  if (method !== 'GET' && method !== 'HEAD') {
    try {
      fetchOptions.body = await req.text()
    } catch {
      // no body
    }
  }

  const res = await fetch(target.url, fetchOptions)
  const body = await res.text()

  let data: any
  try {
    data = JSON.parse(body)
  } catch {
    data = body
  }

  return NextResponse.json(data, { status: res.status })
}

export async function GET(req: NextRequest) {
  return proxyRequest(req)
}

export async function POST(req: NextRequest) {
  return proxyRequest(req)
}

export async function PUT(req: NextRequest) {
  return proxyRequest(req)
}

export async function DELETE(req: NextRequest) {
  return proxyRequest(req)
}
