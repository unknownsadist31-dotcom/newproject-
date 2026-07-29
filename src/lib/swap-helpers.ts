import { assetFromString, Chain, USwapNumber } from '@tcswap/core'
import { intervalToDuration } from 'date-fns'
import { ThorSwapQuoteRoute } from '@/lib/thorswap-api'

export type FeeData = {
  amount: USwapNumber
  usd: USwapNumber
  ticker: string
}

/**
 * THORNode quotes emit fee amounts in 1e8 base units (integer strings).
 * Synthetic quotes may already be display decimals (contain '.').
 * Never treat a raw base-unit integer as a human ETH/BTC amount — that is what produced $12B "Included Fees".
 */
function parseFeeAmount(raw: string): USwapNumber {
  const amount = (raw ?? '').trim()
  if (!amount || amount === '0') return new USwapNumber(0)
  // Decimals / exponents are already human units (both quote sources convert).
  if (amount.includes('.') || amount.includes('e') || amount.includes('E')) {
    return new USwapNumber(amount)
  }
  // Raw THORNode base units (1e8) for any meaningful fee are >= 7 digits.
  // Whole-token display amounts of that size are implausible for a swap fee,
  // so treat big integers as base units (defends against stale API builds).
  if (/^-?\d{7,}$/.test(amount)) {
    try {
      return USwapNumber.fromBigInt(BigInt(amount), 8)
    } catch {
      return new USwapNumber(amount)
    }
  }
  return new USwapNumber(amount)
}

function resolveFeeRate(
  rates: Record<string, number | USwapNumber>,
  feeAsset: string
): USwapNumber | undefined {
  const direct = rates[feeAsset] ?? rates[feeAsset.toUpperCase()] ?? rates[feeAsset.toLowerCase()]
  if (direct !== undefined && direct !== null) {
    return direct instanceof USwapNumber ? direct : new USwapNumber(direct)
  }

  // Case-insensitive / native ticker fallback (ETH.ETH ↔ eth.eth)
  const target = feeAsset.toLowerCase()
  for (const [key, value] of Object.entries(rates)) {
    if (key.toLowerCase() === target) {
      return value instanceof USwapNumber ? value : new USwapNumber(value)
    }
  }

  const ticker = feeAsset.includes('.') ? feeAsset.split('.')[1].split('-')[0] : feeAsset
  if (ticker) {
    const t = ticker.toLowerCase()
    for (const [key, value] of Object.entries(rates)) {
      const keyTicker = key.includes('.') ? key.split('.')[1].split('-')[0] : key
      if (keyTicker.toLowerCase() === t) {
        return value instanceof USwapNumber ? value : new USwapNumber(value)
      }
    }
  }

  return undefined
}

export const resolveFees = (quote: ThorSwapQuoteRoute, rates: Record<string, number | USwapNumber>) => {
  const feeData = (type: string): FeeData | undefined => {
    const fee = quote.fees.find(f => f.type === type)
    if (!fee) return undefined

    const amount = parseFeeAmount(fee.amount)
    const rate = resolveFeeRate(rates, fee.asset)
    const asset = assetFromString(fee.asset)

    return {
      amount,
      usd: rate ? amount.mul(rate) : new USwapNumber(0),
      ticker: asset.ticker || asset.symbol
    }
  }

  const inbound = feeData('inbound')
  const outbound = feeData('outbound')
  const liquidity = feeData('liquidity')
  const affiliate = feeData('affiliate')
  const service = feeData('service')

  const platform: FeeData | undefined = (affiliate || service) && {
    amount: (affiliate?.amount || new USwapNumber(0)).add(service?.amount || new USwapNumber(0)),
    usd: (affiliate?.usd || new USwapNumber(0)).add(service?.usd || new USwapNumber(0)),
    ticker: affiliate?.ticker || service?.ticker || ''
  }

  const included = (outbound?.usd || new USwapNumber(0))
    .add(liquidity?.usd || new USwapNumber(0))
    .add(platform?.usd || new USwapNumber(0))

  return { inbound, outbound, liquidity, platform, included }
}

export const resolvePriceImpact = (
  quote?: ThorSwapQuoteRoute,
  rateFrom?: USwapNumber,
  rateTo?: USwapNumber
) => {
  const slippageBps = quote?.meta?.slippageBps
  if (slippageBps) return new USwapNumber(slippageBps).div(100)

  const sellAmountInUsd = quote && rateFrom && new USwapNumber(quote.sellAmount).mul(rateFrom)
  const buyAmountInUsd = quote && rateTo && new USwapNumber(quote.expectedBuyAmount).mul(rateTo)
  const hundredPercent = new USwapNumber(100)
  const toPriceRatio =
    buyAmountInUsd && sellAmountInUsd && buyAmountInUsd.mul(hundredPercent).div(sellAmountInUsd)
  return toPriceRatio && toPriceRatio.lte(hundredPercent) ? hundredPercent.sub(toPriceRatio) : undefined
}

export const formatExpiration = (seconds: number) => {
  const roundedSeconds = Math.ceil(seconds / 60) * 60
  const duration = intervalToDuration({ start: 0, end: roundedSeconds * 1000 })
  const parts = []

  if (duration.months) parts.push(`${duration.months}M`)
  if (duration.weeks) parts.push(`${duration.weeks}w`)
  if (duration.days) parts.push(`${duration.days}d`)
  if (duration.hours) parts.push(`${duration.hours}h`)
  if (duration.minutes) parts.push(`${duration.minutes}m`)
  if (duration.seconds && !(duration.hours || duration.days || duration.weeks)) {
    parts.push(`${duration.seconds}s`)
  }

  return parts.join(' ')
}

export function normalizeThorBankDenom(denom: string): string | null {
  const lower = denom.toLowerCase()

  if (lower.startsWith('x/')) return `${Chain.THORChain}.${lower.slice(2).toUpperCase()}`
  if (lower.includes('/') || lower.includes('~')) return `${Chain.THORChain}.${lower.toUpperCase()}`
  if (lower.includes('-')) return lower.toUpperCase()

  return `${Chain.THORChain}.${lower.toUpperCase()}`
}

// Re-export providerLabel from swap component for backward compatibility
export { providerLabel } from '@/components/swap/swap-provider'
