const DEV_LOGO_CDN = 'https://storage.googleapis.com/token-list-swapkit-dev/'
const PROD_LOGO_CDN = 'https://storage.googleapis.com/token-list-swapkit/'
const LOCAL_LOGO_PROXY = '/api/proxy/logos/'

/**
 * Normalize SwapKit logo URLs:
 * - rewrite broken -dev CDN → production CDN
 * - serve production CDN through same-origin proxy (avoids blocked external images)
 */
export function normalizeLogoURI(logoURI?: string | null): string | undefined {
  if (!logoURI) return undefined

  if (logoURI.startsWith(LOCAL_LOGO_PROXY)) return logoURI

  if (logoURI.startsWith(DEV_LOGO_CDN)) {
    return `${LOCAL_LOGO_PROXY}${logoURI.slice(DEV_LOGO_CDN.length)}`
  }

  if (logoURI.startsWith(PROD_LOGO_CDN)) {
    return `${LOCAL_LOGO_PROXY}${logoURI.slice(PROD_LOGO_CDN.length)}`
  }

  return logoURI
}

/** Local network badge / native token fallback under /public/networks */
export function networkIconPath(chain?: string | null): string | undefined {
  if (!chain) return undefined
  return `/networks/${String(chain).toLowerCase()}.svg`
}

const NATIVE_GAS_PAIRS = new Set([
  'thor.rune',
  'bsc.bnb',
  'gaia.atom',
  'tron.trx',
  'maya.cacao',
  'monad.mon',
  'gno.xdai',
  'arb.eth',
  'base.eth',
  'op.eth'
])

/** True when the asset is the chain's native gas token (icon = network logo). */
export function isNativeGasAsset(chain?: string | null, ticker?: string | null): boolean {
  if (!chain || !ticker) return false
  const c = String(chain).toLowerCase()
  const t = String(ticker).toLowerCase()
  return c === t || NATIVE_GAS_PAIRS.has(`${c}.${t}`)
}
