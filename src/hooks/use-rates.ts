import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { USwapNumber } from '@tcswap/core'
import { useQuote } from '@/hooks/use-quote'
import { useAssetFrom, useAssetTo } from '@/hooks/use-swap'
import { getMidgardPools, getMidgardRunePrice } from '@/lib/thorswap-api'
import { getDexScreenerTokens } from '@/lib/api'
import { getMayaMidgardPools, getMayaMidgardCacaoPrice } from '@/lib/mayachain-api'
import axios from 'axios'

export type AssetRateMap = Record<string, USwapNumber>
export type AssetLogoMap = Record<string, string>

const RUNE_IDENTIFIER = 'THOR.RUNE'
const CACAO_IDENTIFIER = 'MAYA.CACAO'

// Chains that are NOT on THORChain Midgard — fetch live prices from CoinGecko
const COINGECKO_CHAIN_MAP: Record<string, string> = {
  SOL: 'solana',
  SOLANA: 'solana',
  XMR: 'monero',
  MONERO: 'monero',
  DASH: 'dash',
  ZEC: 'zcash',
  DOT: 'polkadot',
  POLKADOT: 'polkadot',
  MATIC: 'matic-network',
  POLYGON: 'matic-network'
}

const isMayaProvider = (provider?: string) =>
  provider === 'MAYACHAIN' || provider === 'MAYACHAIN_STREAMING'

export const useRates = (
  identifiers: string[],
  provider?: string
): { rates: AssetRateMap; logos: AssetLogoMap; isLoading: boolean } => {
  // ── CoinGecko prices for chains not on Midgard ──────────────────────────
  const cgIds = useMemo(() => {
    const ids = new Set<string>()
    for (const id of identifiers) {
      const chain = id.split('.')[0].toUpperCase()
      const cgId = COINGECKO_CHAIN_MAP[chain]
      if (cgId) ids.add(cgId)
    }
    return [...ids]
  }, [identifiers])

  const { data: cgPrices } = useQuery({
    queryKey: ['coingecko-prices', cgIds.sort().join(',')],
    queryFn: async () => {
      if (cgIds.length === 0) return {} as Record<string, number>
      try {
        const res = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
          params: { ids: cgIds.join(','), vs_currencies: 'usd' },
          timeout: 5000
        })
        const prices: Record<string, number> = {}
        for (const id of cgIds) {
          const price = res.data[id]?.usd
          if (price) prices[id] = price
        }
        return prices
      } catch {
        return {} as Record<string, number>
      }
    },
    enabled: cgIds.length > 0,
    staleTime: 30000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: false
  })

  // ── Midgard pool prices ────────────────────────────────────────────────
  const { data: midgardData, isLoading: midgardLoading } = useQuery({
    queryKey: ['thorchain-pool-prices'],
    queryFn: async () => {
      const [pools, runePrice, mayaPools, cacaoPrice] = await Promise.all([
        getMidgardPools(),
        getMidgardRunePrice(),
        getMayaMidgardPools().catch(() => [] as { asset: string; assetPriceUSD: string }[]),
        getMayaMidgardCacaoPrice().catch(() => NaN)
      ])

      const thor: AssetRateMap = {}
      const maya: AssetRateMap = {}

      for (const pool of mayaPools) {
        const price = parseFloat(pool.assetPriceUSD)
        if (pool.asset && !isNaN(price) && price > 0) {
          maya[pool.asset.toLowerCase()] = new USwapNumber(price)
        }
      }

      for (const pool of pools) {
        const price = parseFloat(pool.assetPriceUSD)
        if (pool.asset && !isNaN(price) && price > 0) {
          thor[pool.asset.toLowerCase()] = new USwapNumber(price)

          const dotIndex = pool.asset.indexOf('.')
          if (dotIndex > 0) {
            const chainPart = pool.asset.slice(0, dotIndex)
            const tickerPart = pool.asset.slice(dotIndex + 1)
            const securedKey = `${chainPart}-${tickerPart}`.toLowerCase()
            thor[securedKey] = new USwapNumber(price)
          }
        }
      }

      if (!isNaN(runePrice) && runePrice > 0) {
        thor[RUNE_IDENTIFIER.toLowerCase()] = new USwapNumber(runePrice)
      }

      if (!isNaN(cacaoPrice) && cacaoPrice > 0) {
        maya[CACAO_IDENTIFIER.toLowerCase()] = new USwapNumber(cacaoPrice)
      }

      return { thor, maya }
    },
    staleTime: 3 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: false
  })

  const solanaMints = useMemo(() => {
    const mints: string[] = []
    for (const id of identifiers) {
      if (id.toUpperCase().startsWith('SOL.') && id.includes('-')) {
        const mint = id.split('-').pop()
        if (mint) mints.push(mint)
      }
    }
    return mints
  }, [identifiers])

  const ethAddresses = useMemo(() => {
    const addresses: string[] = []
    for (const id of identifiers) {
      if (id.toUpperCase().startsWith('ETH.') && id.includes('-')) {
        const addr = id.split('-').pop()
        if (addr) addresses.push(addr.toLowerCase())
      }
    }
    return addresses
  }, [identifiers])

  const { data: dexScreenerData, isLoading: dexScreenerLoading } = useQuery({
    queryKey: ['dexscreener-tokens-sol', solanaMints.slice().sort().join(',')],
    queryFn: () => getDexScreenerTokens(solanaMints, 'solana'),
    enabled: solanaMints.length > 0,
    staleTime: 3 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: false
  })

  const { data: dexScreenerEthData, isLoading: dexScreenerEthLoading } = useQuery({
    queryKey: ['dexscreener-tokens-eth', ethAddresses.slice().sort().join(',')],
    queryFn: () => getDexScreenerTokens(ethAddresses, 'ethereum'),
    enabled: ethAddresses.length > 0,
    staleTime: 3 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: false
  })

  const rates: AssetRateMap = {}
  const logos: AssetLogoMap = {}

  // 1. Midgard pool prices (skip chains where THORChain trading is halted)
  const MIDGARD_HALTED_CHAINS = new Set(['SOL', 'SOLANA', 'XMR', 'MONERO', 'BASE', 'ARB', 'ARBITRUM', 'OP', 'OPTIMISM'])
  if (midgardData) {
    const preferMaya = isMayaProvider(provider)
    const primary = preferMaya ? midgardData.maya : midgardData.thor
    const secondary = preferMaya ? midgardData.thor : midgardData.maya
    for (const id of identifiers) {
      const chain = id.split('.')[0].toUpperCase()
      // Skip Midgard prices for halted chains — they're stale
      if (MIDGARD_HALTED_CHAINS.has(chain)) continue
      const key = id.toLowerCase()
      const price = primary[key] ?? secondary[key]
      if (price) rates[id] = price
    }
  }

  // 2. DexScreener for Solana SPL tokens
  if (dexScreenerData) {
    for (const id of identifiers) {
      if (id.toUpperCase().startsWith('SOL.') && id.includes('-')) {
        const mint = id.split('-').pop()!
        const info = dexScreenerData[mint]
        if (info?.price && !rates[id]) rates[id] = new USwapNumber(info.price)
        if (info?.logo) logos[id] = info.logo
      }
    }
  }

  // 3. DexScreener for Ethereum tokens
  if (dexScreenerEthData) {
    for (const id of identifiers) {
      if (id.toUpperCase().startsWith('ETH.') && id.includes('-')) {
        const addr = id.split('-').pop()!.toLowerCase()
        const info = dexScreenerEthData[addr]
        if (info?.price && !rates[id]) rates[id] = new USwapNumber(info.price)
        if (info?.logo) logos[id] = info.logo
      }
    }
  }

  // 4. CoinGecko fallback for chains not on Midgard (SOL, XMR, etc.)
  if (cgPrices) {
    for (const id of identifiers) {
      if (rates[id]) continue
      const chain = id.split('.')[0].toUpperCase()
      const cgId = COINGECKO_CHAIN_MAP[chain]
      if (cgId && cgPrices[cgId]) {
        rates[id] = new USwapNumber(cgPrices[cgId])
      }
    }
  }

  const dexScreenerPending = solanaMints.length > 0 && dexScreenerLoading
  const dexScreenerEthPending = ethAddresses.length > 0 && dexScreenerEthLoading

  return {
    rates,
    logos,
    isLoading: midgardLoading || dexScreenerPending || dexScreenerEthPending || identifiers.length === 0
  }
}

export const useSwapRates = () => {
  const assetFrom = useAssetFrom()
  const assetTo = useAssetTo()
  const identifiers = [assetFrom?.identifier, assetTo?.identifier].filter(Boolean).sort() as string[]
  const { quote } = useQuote()
  const { rates } = useRates(identifiers, quote?.providers[0])

  return {
    rateFrom: assetFrom && rates[assetFrom.identifier],
    rateTo: assetTo && rates[assetTo.identifier]
  }
}
