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

// ── Quote ──────────────────────────────────────────────────────────────────

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

function toBaseUnits(amount: string, decimals: number): string {
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

// ── CoinGecko price cache ──────────────────────────────────────────────────

const priceCache = new Map<string, { price: number; ts: number }>()
const CACHE_TTL = 60000 // 1 minute

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
  } catch {
    // fall through to DexScreener
  }
  return null
}

async function getDexScreenerPrice(tokenAddress: string, chain: string): Promise<number | null> {
  try {
    const res = await axios.get(`${PROXY}/dexscreener/latest/dex/tokens/${tokenAddress}`, { timeout: 5000 })
    const pairs = res.data?.pairs
    if (pairs && pairs.length > 0) {
      return parseFloat(pairs[0].priceUsd) || null
    }
  } catch {
    // ignore
  }
  return null
}

// ── Synthetic Quote for non-THORChain chains (Solana, Monero) ──────────────

const SYNTHETIC_CHAINS = ['SOL', 'SOLANA', 'XMR', 'MONERO']

const COINGECKO_ID_MAP: Record<string, string> = {
  SOL: 'solana',
  SOLANA: 'solana',
  XMR: 'monero',
  MONERO: 'monero'
}

async function getSyntheticQuote(params: GetQuoteParams): Promise<ThorSwapQuoteRoute[]> {
  const sellChain = params.sellAsset.split('.')[0].toUpperCase()
  const buyChain = params.buyAsset.split('.')[0].toUpperCase()

  const sellCgId = COINGECKO_ID_MAP[sellChain]
  const buyCgId = COINGECKO_ID_MAP[buyChain]

  const [sellPrice, buyPrice] = await Promise.all([
    sellCgId ? getCoinGeckoPrice(sellCgId) : null,
    buyCgId ? getCoinGeckoPrice(buyCgId) : null
  ])

  if (!sellPrice || !buyPrice) {
    throw new Error(`Unable to fetch live price for ${!sellPrice ? params.sellAsset : params.buyAsset}. Try again shortly.`)
  }

  const sellAmount = parseFloat(params.sellAmount)
  const sellUsd = sellAmount * sellPrice
  const rawBuy = sellUsd / buyPrice
  const feeRate = 0.005 // 0.5% synthetic fee
  const buyAfterFee = rawBuy * (1 - feeRate)

  const buyDecimals = params.buyDecimals || 8
  const sellDecimals = params.decimals || 8
  const buyAmountDisplay = buyAfterFee.toFixed(Math.min(buyDecimals, 8))
  const buyAmountBase = toBaseUnits(buyAfterFee.toFixed(buyDecimals), buyDecimals)
  const sellAmountBase = toBaseUnits(params.sellAmount, sellDecimals)

  const now = Math.floor(Date.now() / 1000)
  const expiry = now + 900 // 15 minutes

  const route: ThorSwapQuoteRoute = {
    sellAsset: params.sellAsset,
    buyAsset: params.buyAsset,
    sellAmount: params.sellAmount,
    buyAmount: buyAmountDisplay,
    expectedBuyAmount: buyAmountDisplay,
    fees: [
      {
        type: 'liquidity',
        asset: params.buyAsset,
        amount: toBaseUnits((rawBuy * feeRate * 0.8).toFixed(buyDecimals), buyDecimals)
      },
      {
        type: 'outbound',
        asset: params.buyAsset,
        amount: toBaseUnits((rawBuy * feeRate * 0.2).toFixed(buyDecimals), buyDecimals)
      },
      { type: 'inbound', asset: params.buyAsset, amount: '0' }
    ],
    providers: ['SYNTHETIC'],
    destinationAddress: params.recipientAddress || '',
    expiration: String(expiry),
    estimatedTime: { total: 300 },
    meta: {
      slippageBps: 50, // 0.5% for synthetic
      hasStreamingSwap: false
    }
  }

  return [route]
}

// ── Main getQuote ──────────────────────────────────────────────────────────

export const getQuote = async (params: GetQuoteParams): Promise<ThorSwapQuoteRoute[]> => {
  const sellChain = params.sellAsset.split('.')[0].toUpperCase()
  const buyChain = params.buyAsset.split('.')[0].toUpperCase()

  // Route Solana/Monero through synthetic quote provider
  if (
    SYNTHETIC_CHAINS.includes(sellChain) ||
    SYNTHETIC_CHAINS.includes(buyChain)
  ) {
    return getSyntheticQuote(params)
  }

  const sellDecimals = params.decimals ?? 8
  const amount = toBaseUnits(params.sellAmount, sellDecimals)

  const queryParams: Record<string, string> = {
    from_asset: params.sellAsset,
    to_asset: params.buyAsset,
    amount
  }

  if (params.streamingInterval) queryParams.streaming_interval = String(params.streamingInterval)
  if (params.streamingQuantity) queryParams.streaming_quantity = String(params.streamingQuantity)
  if (params.affiliateBps) queryParams.affiliate_bps = String(params.affiliateBps)
  if (params.affiliateAddress) queryParams.affiliate_address = params.affiliateAddress

  const res = await thornode.get<THORNodeQuoteResponse>('/thorchain/quote/swap', { params: queryParams })
  const data = res.data

  const buyDecimals = params.buyDecimals || 8
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

  const route: ThorSwapQuoteRoute = {
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

  return [route]
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
