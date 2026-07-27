import axios from 'axios'

const PROXY = '/api/proxy'
const THORSWAP_API = `${PROXY}/thorswap/aggregator/tokens/quote`
const THORSWAP_TOKENLIST = `${PROXY}/thorswap/tokenlist`
const MIDGARD_API = `${PROXY}/lq-midgard`
const THORNODE_API = `${PROXY}/lq-thornode`

const api = axios.create({
  baseURL: THORSWAP_API,
  headers: {
    'Referer': 'thorswap-ui'
  }
})

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

export const getQuote = async (params: GetQuoteParams): Promise<ThorSwapQuoteRoute[]> => {
  const queryParams: Record<string, string> = {
    sellAsset: params.sellAsset,
    buyAsset: params.buyAsset,
    sellAmount: params.sellAmount
  }

  if (params.senderAddress) queryParams.senderAddress = params.senderAddress
  if (params.recipientAddress) queryParams.recipientAddress = params.recipientAddress
  if (params.slippage !== undefined) queryParams.slippage = String(params.slippage)
  if (params.limit !== undefined) queryParams.limit = String(params.limit)
  if (params.streamingInterval) queryParams.streamingInterval = String(params.streamingInterval)
  if (params.streamingQuantity) queryParams.streamingQuantity = String(params.streamingQuantity)
  if (params.affiliateBps) queryParams.affiliateBps = String(params.affiliateBps)
  if (params.affiliateAddress) queryParams.affiliateAddress = params.affiliateAddress
  if (params.providers?.length) queryParams.providers = params.providers.join(',')

  const res = await api.get<ThorSwapQuoteResponse>('', { params: queryParams })
  return res.data.routes || []
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
