import axios from 'axios'

const PROXY = '/api/proxy'
const THORSWAP_TOKENLIST = '/api/tokenlist'
const MIDGARD_API = `${PROXY}/lq-midgard`
const THORNODE_API = `${PROXY}/lq-thornode`
const COINGECKO_API = 'https://api.coingecko.com/api/v3'

const midgard = axios.create({ baseURL: MIDGARD_API })
const thornode = axios.create({ baseURL: THORNODE_API })

// ── Types ──────────────────────────────────────────────────────────────────

export interface ThorSwapFee {
  type: string
  asset: string
  amount: string
}

export interface ThorSwapQuoteRoute {
  sellAsset: string
  buyAsset: string
  sellAmount: string
  buyAmount: string
  expectedBuyAmount: string
  fees: ThorSwapFee[]
  memo?: string
  inboundAddress?: string
  destinationAddress?: string
  sourceAddress?: string
  refundAddress?: string
  estimatedTime?: { total: number }
  expiration?: string
  providers: string[]
  meta?: {
    slippageBps?: number
    hasStreamingSwap?: boolean
    approvalAddress?: string
  }
  contractParams?: {
    to: string
    value: string
    data: string
    gasLimit: string
  }
  qrCodeDataURL?: string
}

export interface ThorSwapQuoteResponse {
  routes: ThorSwapQuoteRoute[]
}

export interface ThorSwapToken {
  identifier: string
  chain: string
  chainId: string
  decimals: number
  ticker: string
  name?: string
  address?: string
  logoURI?: string
  coingeckoId?: string
  shortCode?: string
  isNative?: boolean
}

export interface ThorSwapTokenList {
  tokens: ThorSwapToken[]
  providers: string[]
}

export interface InboundAddress {
  chain: string
  address: string
  router?: string
  halted: boolean
  chain_lp_actions_paused?: boolean
  gas_rate?: string
  dust_threshold?: string
  outbound_fee?: string
}

// ── Quote Params ───────────────────────────────────────────────────────────

export interface GetQuoteParams {
  sellAsset: string
  buyAsset: string
  sellAmount: string
  decimals?: number
  buyDecimals?: number
  senderAddress?: string
  recipientAddress?: string
  slippage?: number
  limit?: number
  streamingInterval?: number
  streamingQuantity?: number
  affiliateBps?: number
  affiliateAddress?: string
  providers?: string[]
}

// ── Unit Conversion Helpers ────────────────────────────────────────────────

function toBaseUnits(amount: string, decimals: number): string {
  if (!decimals || decimals <= 0) return amount
  const [whole = '0', frac = ''] = amount.split('.')
  const padded = (frac || '').padEnd(decimals, '0').slice(0, decimals)
  const combined = whole + padded
  return BigInt(combined).toString()
}

function fromBaseUnits(amount: string, decimals: number): string {
  if (!decimals || decimals <= 0) return amount
  const neg = amount.startsWith('-')
  const abs = neg ? amount.slice(1) : amount
  const padded = abs.padStart(decimals + 1, '0')
  const idx = padded.length - decimals
  const whole = padded.slice(0, idx)
  let frac = padded.slice(idx)
  frac = frac.replace(/0+$/, '')
  const result = frac.length > 0 ? `${whole}.${frac}` : whole
  return neg ? `-${result}` : result
}

// ── THORNode Response Types ────────────────────────────────────────────────

interface THORNodeQuoteFees {
  asset: string
  affiliate: string
  outbound: string
  liquidity: string
  total: string
  slippage_bps: number
  total_bps: number
}

interface THORNodeQuoteResponse {
  expected_amount_out: string
  fees: THORNodeQuoteFees
  inbound_address: string
  router: string
  expiry: number
  dust_threshold: string
  recommended_min_amount_in: string
  streaming_swap_blocks: number
  streaming_swap_seconds: number
  total_swap_seconds: number
  max_streaming_quantity: number
  inbound_confirmation_blocks: number
  inbound_confirmation_seconds: number
  outbound_delay_blocks: number
  outbound_delay_seconds: number
  warning: string
  notes: string
}

interface THORNodeErrorResponse {
  code: number
  message: string
  details: unknown[]
}

// ── CoinGecko Price Cache ──────────────────────────────────────────────────

const priceCache = new Map<string, { price: number; ts: number }>()
const CACHE_TTL = 30000 // 30 seconds

async function getCoinGeckoPrice(coingeckoId: string): Promise<number | null> {
  const cached = priceCache.get(coingeckoId)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.price

  try {
    const res = await axios.get(`${COINGECKO_API}/simple/price`, {
      params: { ids: coingeckoId, vs_currencies: 'usd' },
      timeout: 5000
    })
    const price = res.data[coingeckoId]?.usd
    if (price) {
      priceCache.set(coingeckoId, { price, ts: Date.now() })
      return price
    }
  } catch { /* fall through */ }
  return null
}

async function getCoinGeckoPrices(ids: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {}
  const fresh: string[] = []

  for (const id of ids) {
    const cached = priceCache.get(id)
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      result[id] = cached.price
    } else {
      fresh.push(id)
    }
  }

  if (fresh.length > 0) {
    try {
      const res = await axios.get(`${COINGECKO_API}/simple/price`, {
        params: { ids: fresh.join(','), vs_currencies: 'usd' },
        timeout: 5000
      })
      for (const id of fresh) {
        const price = res.data[id]?.usd
        if (price) {
          result[id] = price
          priceCache.set(id, { price, ts: Date.now() })
        }
      }
    } catch { /* use cached only */ }
  }

  return result
}

// ── Chain → CoinGecko ID Mapping ──────────────────────────────────────────

const CHAIN_TO_COINGECKO: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BSC: 'binancecoin',
  BNB: 'binancecoin',
  AVAX: 'avalanche-2',
  BASE: 'ethereum',       // Base ETH uses ethereum price
  GAIA: 'cosmos',
  ATOM: 'cosmos',
  DOGE: 'dogecoin',
  BCH: 'bitcoin-cash',
  LTC: 'litecoin',
  XRP: 'ripple',
  TRON: 'tron',
  TRX: 'tron',
  THOR: 'thorchain',
  RUNE: 'thorchain',
  SOL: 'solana',
  SOLANA: 'solana',
  XMR: 'monero',
  MONERO: 'monero',
  ARB: 'ethereum',        // Arbitrum ETH uses ethereum price
  ARBITRUM: 'ethereum',
  DASH: 'dash',
  ZEC: 'zcash',
  MAYA: 'maya-protocol',
  CACAO: 'maya-protocol',
  DOT: 'polkadot',
  POLKADOT: 'polkadot',
  MATIC: 'matic-network',
  POLYGON: 'matic-network',
  OP: 'ethereum',         // Optimism ETH
  OPTIMISM: 'ethereum',
}

function getCgIdForAsset(identifier: string): string | null {
  const chain = identifier.split('.')[0].toUpperCase()
  return CHAIN_TO_COINGECKO[chain] || null
}

// ── Synthetic Quote (CoinGecko cross-rate) ─────────────────────────────────

async function buildSyntheticQuote(
  params: GetQuoteParams,
  sellUsdPrice: number,
  buyUsdPrice: number
): Promise<ThorSwapQuoteRoute[]> {
  const sellAmount = parseFloat(params.sellAmount)
  const sellUsd = sellAmount * sellUsdPrice
  const rawBuy = sellUsd / buyUsdPrice
  const feeRate = 0.005
  const buyAfterFee = rawBuy * (1 - feeRate)

  const buyDecimals = params.buyDecimals || 8
  const now = Math.floor(Date.now() / 1000)

  const route: ThorSwapQuoteRoute = {
    sellAsset: params.sellAsset,
    buyAsset: params.buyAsset,
    sellAmount: params.sellAmount,
    buyAmount: buyAfterFee.toFixed(Math.min(buyDecimals, 8)),
    expectedBuyAmount: buyAfterFee.toFixed(Math.min(buyDecimals, 8)),
    fees: [
      {
        type: 'liquidity',
        asset: params.buyAsset,
        amount: toBaseUnits((rawBuy * feeRate * 0.8).toFixed(buyDecimals), buyDecimals)
      },
      { type: 'inbound', asset: params.buyAsset, amount: '0' }
    ],
    providers: ['SYNTHETIC'],
    destinationAddress: params.recipientAddress || '',
    expiration: String(now + 900),
    estimatedTime: { total: 300 },
    meta: {
      slippageBps: 50,
      hasStreamingSwap: false
    }
  }

  return [route]
}

async function trySyntheticQuote(params: GetQuoteParams): Promise<ThorSwapQuoteRoute[] | null> {
  const sellCgId = getCgIdForAsset(params.sellAsset)
  const buyCgId = getCgIdForAsset(params.buyAsset)

  const ids = [...new Set([sellCgId, buyCgId].filter(Boolean) as string[])]
  if (ids.length < 2) return null

  const prices = await getCoinGeckoPrices(ids)
  const sellPrice = sellCgId ? prices[sellCgId] : undefined
  const buyPrice = buyCgId ? prices[buyCgId] : undefined

  if (!sellPrice || !buyPrice) return null
  return buildSyntheticQuote(params, sellPrice, buyPrice)
}

// ── THORNode Quote → Route Mapping ─────────────────────────────────────────

function thornodeResponseToRoute(
  params: GetQuoteParams,
  data: THORNodeQuoteResponse
): ThorSwapQuoteRoute {
  // THORChain uses 8 decimals for native/gas assets internally,
  // regardless of what the tokenlist says. Only contract tokens
  // (identifiers containing a dash) use their native decimals.
  const isNativeAsset = !params.buyAsset.includes('-')
  const buyDecimals = isNativeAsset ? 8 : (params.buyDecimals || 8)
  const buyAmountDisplay = fromBaseUnits(data.expected_amount_out, buyDecimals)

  const feeAsset = data.fees.asset || params.buyAsset
  const fees: ThorSwapFee[] = []

  if (data.fees.liquidity && data.fees.liquidity !== '0') {
    fees.push({ type: 'liquidity', asset: feeAsset, amount: data.fees.liquidity })
  }
  if (data.fees.outbound && data.fees.outbound !== '0') {
    fees.push({ type: 'outbound', asset: feeAsset, amount: data.fees.outbound })
  }

  const totalFee = BigInt(data.fees.total || '0')
  const liquidityFee = BigInt(data.fees.liquidity || '0')
  const outboundFee = BigInt(data.fees.outbound || '0')
  const affiliateFee = totalFee - liquidityFee - outboundFee
  if (affiliateFee > 0n) {
    fees.push({ type: 'affiliate', asset: feeAsset, amount: affiliateFee.toString() })
  }

  fees.push({ type: 'inbound', asset: feeAsset, amount: '0' })

  return {
    sellAsset: params.sellAsset,
    buyAsset: params.buyAsset,
    sellAmount: params.sellAmount,
    buyAmount: buyAmountDisplay,
    expectedBuyAmount: buyAmountDisplay,
    fees,
    providers: params.providers || ['THORCHAIN'],
    inboundAddress: data.inbound_address,
    destinationAddress: data.router,
    expiration: String(data.expiry),
    estimatedTime: data.total_swap_seconds ? { total: data.total_swap_seconds } : undefined,
    meta: {
      slippageBps: data.fees.slippage_bps,
      hasStreamingSwap: (data.streaming_swap_blocks || 0) > 0
    }
  }
}

// ── Main getQuote (THORNode first, synthetic fallback) ─────────────────────

async function tryTHORNodeQuote(params: GetQuoteParams): Promise<ThorSwapQuoteRoute[] | null> {
  const sellDecimals = params.decimals ?? 8
  const amount = toBaseUnits(params.sellAmount, sellDecimals)

  const queryParams: Record<string, string> = {
    from_asset: params.sellAsset,
    to_asset: params.buyAsset,
    amount,
  }

  if (params.streamingInterval) queryParams.streaming_interval = String(params.streamingInterval)
  if (params.streamingQuantity) queryParams.streaming_quantity = String(params.streamingQuantity)
  if (params.affiliateBps) queryParams.affiliate_bps = String(params.affiliateBps)
  if (params.affiliateAddress) queryParams.affiliate_address = params.affiliateAddress

  try {
    const res = await thornode.get<THORNodeQuoteResponse>('/thorchain/quote/swap', {
      params: queryParams,
      validateStatus: (s) => s === 200
    })
    return [thornodeResponseToRoute(params, res.data)]
  } catch (err: unknown) {
    // THORNode failed — log and fall back to synthetic
    if (axios.isAxiosError(err) && err.response?.data) {
      const body = err.response.data as THORNodeErrorResponse
      if (body?.message) {
        console.warn(`THORNode quote failed (${params.sellAsset} → ${params.buyAsset}): ${body.message}`)
      }
    }
    return null
  }
}

export const getQuote = async (params: GetQuoteParams): Promise<ThorSwapQuoteRoute[]> => {
  // Try THORNode first
  const thornodeResult = await tryTHORNodeQuote(params)
  if (thornodeResult) return thornodeResult

  // Fall back to synthetic
  const syntheticResult = await trySyntheticQuote(params)
  if (syntheticResult) return syntheticResult

  throw new Error(
    `No quote available for ${params.sellAsset} → ${params.buyAsset}. ` +
    `THORChain does not support this pair and no price data is available for synthetic routing.`
  )
}

// ── Token List ─────────────────────────────────────────────────────────────

let cachedTokens: ThorSwapToken[] | null = null
let cachedProviders: string[] | null = null

export const getTokenList = async (provider?: string): Promise<ThorSwapTokenList> => {
  if (cachedTokens && cachedProviders) {
    return { tokens: cachedTokens, providers: cachedProviders || [] }
  }

  const params: Record<string, string> = {}
  if (provider) params.provider = provider

  const res = await axios.get<{ tokens: ThorSwapToken[]; providers?: string[] }>(THORSWAP_TOKENLIST, { params })
  const tokens = res.data.tokens || []
  const providers = res.data.providers || []

  cachedTokens = tokens
  cachedProviders = providers

  return { tokens, providers }
}

// ── THORChain Inbound Addresses ────────────────────────────────────────────

export const getInboundAddresses = async (): Promise<InboundAddress[]> => {
  return thornode.get('/thorchain/inbound_addresses').then(res => res.data)
}

// ── Midgard Pools & Stats ──────────────────────────────────────────────────

export const getMidgardPools = async (): Promise<{ asset: string; assetPriceUSD: string }[]> => {
  return midgard.get('/v2/pools').then(res => res.data)
}

export const getMidgardRunePrice = async (): Promise<number> => {
  return midgard.get('/v2/stats').then(res => parseFloat(res.data.runePriceUSD))
}

// ── THORChain Mimir ────────────────────────────────────────────────────────

export const getMimir = async (): Promise<Record<string, number>> => {
  return thornode.get('/thorchain/mimir').then(res => res.data)
}

// ── Asset Rate from Midgard ────────────────────────────────────────────────

export const getAssetRates = async (): Promise<Record<string, number>> => {
  try {
    const pools = await getMidgardPools()
    const rates: Record<string, number> = {}
    for (const pool of pools) {
      if (pool.assetPriceUSD) {
        rates[pool.asset] = parseFloat(pool.assetPriceUSD)
      }
    }
    return rates
  } catch {
    return {}
  }
}
