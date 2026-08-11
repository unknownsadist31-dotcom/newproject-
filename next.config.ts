import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { SUBDOMAIN_ROUTES } from '@/config'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')
const discoveryLinks = [
  '</.well-known/mcp-server-card.json>; rel="mcp-server-card"; type="application/json"',
  '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
  '</openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
  '</auth.md>; rel="service-doc"; type="text/markdown"',
  '</llms.txt>; rel="alternate"; type="text/markdown"',
  '</.well-known/agent-skills/index.json>; rel="describedby"; type="application/json"'
].join(', ')

const proxyRewrites = [
  // THORSwap API
  { source: '/api/proxy/thorswap/:path*', destination: 'https://api.thorswap.net/:path*' },
  // THORChain memoless
  { source: '/api/proxy/thorchain/:path*', destination: 'https://api.thorchain.org/:path*' },
  // Liquify THORNode
  { source: '/api/proxy/lq-thornode/:path*', destination: 'https://gateway.liquify.com/chain/thorchain_api/:path*' },
  // Liquify Midgard
  { source: '/api/proxy/lq-midgard/:path*', destination: 'https://gateway.liquify.com/chain/thorchain_midgard/:path*' },
  // Maya Midgard
  { source: '/api/proxy/mayamidgard/:path*', destination: 'https://midgard.mayachain.info/:path*' },
  // MayaNode
  { source: '/api/proxy/mayanode/:path*', destination: 'https://mayanode.mayachain.info/:path*' },
  // DexScreener
  { source: '/api/proxy/dexscreener/:path*', destination: 'https://api.dexscreener.com/:path*' },
  // SwapKit Token Logo CDN (production bucket; -dev 404s for many assets)
  { source: '/api/proxy/logos/:path*', destination: 'https://storage.googleapis.com/token-list-swapkit/:path*' },
]

const nextConfig: NextConfig = {
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/',
        headers: [
          {
            key: 'Link',
            value: discoveryLinks
          }
        ]
      },
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Signal',
            value: 'search=yes, ai-input=yes, ai-train=yes'
          }
        ]
      }
    ]
  },
  async rewrites() {
    return {
      beforeFiles: SUBDOMAIN_ROUTES.map(({ host, path }) => ({
        source: '/',
        has: [{ type: 'host', value: host }],
        destination: path
      })),
      afterFiles: proxyRewrites,
      fallback: []
    }
  }
}

export default withNextIntl(nextConfig)
