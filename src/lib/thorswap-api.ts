import axios from 'axios'

const PROXY = '/api/proxy'
const THORSWAP_TOKENLIST = '/api/tokenlist'
const MIDGARD_API = `${PROXY}/lq-midgard`
const THORNODE_API = `${PROXY}/lq-thornode`

const midgard = axios.create({ baseURL: MIDGARD_API })
const thornode = axios.create({ baseURL: THORNODE_API })

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

export interface GetQuoteParams {
  sellAsset: string
  buyAsset: string
  sellAmount: string
  decimals?: number
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

export const getQuote = async (params: GetQuoteParams): Promise<ThorSwapQuoteRoute[]> => {
  const amount = params.decimals
    ? toBaseUnits(params.sellAmount, params.decimals)
    : params.sellAmount

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
    buyAmount: data.expected_amount_out,
    expectedBuyAmount: data.expected_amount_out,
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

export const getInboundAddresses = async (): Promise<InboundAddress[]> => {
  return thornode.get('/thorchain/inbound_addresses').then(res => res.data)
}

export const getMidgardPools = async (): Promise<{ asset: string; assetPriceUSD: string }[]> => {
  return midgard.get('/v2/pools').then(res => res.data)
}

export const getMidgardRunePrice = async (): Promise<number> => {
  return midgard.get('/v2/stats').then(res => parseFloat(res.data.runePriceUSD))
}

export const getMimir = async (): Promise<Record<string, number>> => {
  return thornode.get('/thorchain/mimir').then(res => res.data)
}

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
