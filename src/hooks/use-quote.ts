import { RefetchOptions, useQuery } from '@tanstack/react-query'
import { useAssetFrom, useAssetTo, useCustomInterval, useCustomQuantity, useSlippage, useSwap } from '@/hooks/use-swap'
import { getQuote, ThorSwapQuoteRoute } from '@/lib/thorswap-api'

type UseQuote = {
  isLoading: boolean
  refetch: (options?: RefetchOptions) => void
  quote?: ThorSwapQuoteRoute
  error: Error | null
}

export const useQuote = (): UseQuote => {
  const { valueFrom } = useSwap()
  const slippage = useSlippage()
  const assetFrom = useAssetFrom()
  const assetTo = useAssetTo()
  const customInterval = useCustomInterval()
  const customQuantity = useCustomQuantity()

  const queryKey = [
    'quote',
    valueFrom.toSignificant(),
    assetFrom?.identifier,
    assetTo?.identifier,
    assetFrom?.chain,
    assetTo?.chain,
    slippage,
    customInterval,
    customQuantity
  ]

  const {
    data: quote,
    refetch,
    isLoading,
    isRefetching,
    error
  } = useQuery({
    queryKey,
    queryFn: ({ signal }) => {
      if (valueFrom.eqValue(0)) return undefined
      if (!assetFrom?.identifier || !assetTo?.identifier) return undefined

      return getQuote({
        sellAsset: assetFrom.identifier,
        buyAsset: assetTo.identifier,
        sellAmount: valueFrom.toSignificant(),
        decimals: assetFrom.decimals ?? 8,
        buyDecimals: assetTo.decimals ?? 8,
        slippage: slippage ?? 3,
        streamingInterval: customInterval || undefined,
        streamingQuantity: customQuantity || undefined,
        providers: ['THORCHAIN', 'MAYACHAIN']
      }).then(routes => {
        if (!routes || routes.length === 0) return undefined

        const preferred =
          routes.find(r => r.providers[0] === 'THORCHAIN_STREAMING') ||
          routes.find(r => r.providers[0] === 'THORCHAIN') ||
          routes.find(r => r.meta?.isDepositQuote || r.providers[0] === 'SYNTHETIC')
        return preferred || routes[0]
      })
    },
    enabled: !!(!valueFrom.eqValue(0) && assetFrom?.identifier && assetTo?.identifier),
    retry: 1,
    retryDelay: 2000,
    refetchOnMount: false,
    staleTime: 15000
  })

  let newError = error as Error | null
  if (error && !(error instanceof Error)) {
    newError = new Error(String(error))
  }

  return {
    isLoading: isLoading || isRefetching,
    refetch,
    quote: isLoading || isRefetching || error ? undefined : quote,
    error: newError
  }
}
