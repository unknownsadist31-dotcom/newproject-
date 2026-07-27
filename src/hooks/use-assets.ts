import { useQuery } from '@tanstack/react-query'
import { Asset } from '@/components/swap/asset'
import { getTokenList } from '@/lib/thorswap-api'

export const useAssets = (): { assets?: Asset[]; isLoading: boolean } => {
  const { data, isLoading } = useQuery({
    queryKey: ['assets'],
    queryFn: async () => {
      const { tokens } = await getTokenList()

      const assets = new Map<string, Asset>()

      for (const token of tokens) {
        if (!token.chain || !token.identifier) continue

        const key = `${token.chain}-${token.identifier}`.toLowerCase()

        const asset: Asset = {
          address: token.address,
          chain: token.chain as any,
          chainId: token.chainId,
          coingeckoId: token.coingeckoId,
          decimals: token.decimals,
          identifier: token.identifier,
          isSecuredAsset: undefined,
          isTradeAsset: undefined,
          logoURI: token.logoURI,
          name: token.name || token.ticker,
          providers: ['THORCHAIN', 'MAYACHAIN'],
          shortCode: token.shortCode,
          ticker: token.ticker
        }

        if (!assets.has(key)) {
          assets.set(key, asset)
        }
      }

      return Array.from(assets.values())
    },
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000
  })

  return { assets: data, isLoading }
}
