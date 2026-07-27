import { useQuery } from '@tanstack/react-query'
import axios from 'axios'

interface MemolessAsset {
  asset: string
  status: string
  decimals: number
}

export const useMemolessAssets = (): { assets: MemolessAsset[] | undefined; isLoading: boolean } => {
  const { data, isLoading } = useQuery({
    queryKey: ['memoless-assets'],
    queryFn: async () => {
      try {
        const res = await axios.get('/api/proxy/thorchain/memoless/api/v1/assets')
        const assets: MemolessAsset[] = res.data?.assets || []
        return assets.filter(asset => asset.status === 'Available')
      } catch {
        return []
      }
    },
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000
  })

  return { assets: data, isLoading }
}
