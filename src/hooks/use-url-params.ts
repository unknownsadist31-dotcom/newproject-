'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { Asset } from '@/components/swap/asset'
import { useAssets } from '@/hooks/use-assets'
import { normalizeLogoURI } from '@/lib/logo-uri'
import { useSwapStore } from '@/store/swap-store'

const DEFAULT_SELL = 'BTC.BTC'
const DEFAULT_BUY = 'ETH.ETH'
const SELL = 'sell-'
const BUY = '-buy-'

const isNativeAsset = (asset: Asset) => asset.chain === asset.ticker && !asset.isSecuredAsset && !asset.isTradeAsset
const toSlug = (asset: Asset) => (isNativeAsset(asset) ? asset.ticker : asset.identifier)

function parsePath(pathname: string): { sell: string | null; buy: string | null } {
  if (!pathname.startsWith(`/${SELL}`)) return { sell: null, buy: null }
  const rest = pathname.slice(1 + SELL.length)
  const idx = rest.indexOf(BUY)
  if (idx === -1) return { sell: null, buy: null }
  return {
    sell: decodeURIComponent(rest.slice(0, idx)),
    buy: decodeURIComponent(rest.slice(idx + BUY.length))
  }
}

function resolveAsset(assets: Asset[], token: string | null, fallback: string): Asset | undefined {
  if (token) {
    const lower = token.toLowerCase()
    const exact = assets.find(a => a.identifier.toLowerCase() === lower)
    if (exact) return exact
    if (!token.includes('.')) {
      const nativeAsset = assets.find(a => a.ticker.toLowerCase() === lower && isNativeAsset(a))
      if (nativeAsset) return nativeAsset
    }
  }
  return assets.find(a => a.identifier === fallback)
}

/** Merge persisted asset with fresh tokenlist fields (especially logoURI). */
function refreshAsset(assets: Asset[], asset?: Asset): Asset | undefined {
  if (!asset) return undefined
  const fresh = assets.find(a => a.identifier.toLowerCase() === asset.identifier.toLowerCase())
  if (fresh) {
    return {
      ...asset,
      ...fresh,
      logoURI: normalizeLogoURI(fresh.logoURI || asset.logoURI)
    }
  }
  return {
    ...asset,
    logoURI: normalizeLogoURI(asset.logoURI)
  }
}

export const useUrlParams = () => {
  const pathname = usePathname()
  const { assets } = useAssets()
  const { assetFrom, assetTo, hasHydrated, setAssetFrom, setAssetTo } = useSwapStore()
  const initialized = useRef(false)
  const skipNextSync = useRef(true)
  const logosRefreshed = useRef(false)

  // Init store from URL (once)
  useEffect(() => {
    if (!assets?.length || !hasHydrated || initialized.current) return

    const { sell, buy } = parsePath(pathname)
    const sellAsset = resolveAsset(assets, sell, DEFAULT_SELL)
    const buyAsset = resolveAsset(assets, buy, DEFAULT_BUY)

    if (sellAsset) setAssetFrom(sellAsset)
    if (buyAsset && buyAsset.identifier !== sellAsset?.identifier) setAssetTo(buyAsset)

    initialized.current = true
    logosRefreshed.current = true
  }, [assets, hasHydrated, pathname, setAssetFrom, setAssetTo])

  // Refresh logos on assets that were restored from localStorage with stale/broken logoURI
  useEffect(() => {
    if (!assets?.length || !hasHydrated || logosRefreshed.current) return
    if (!assetFrom && !assetTo) return

    const nextFrom = refreshAsset(assets, assetFrom)
    const nextTo = refreshAsset(assets, assetTo)
    if (nextFrom) setAssetFrom(nextFrom)
    if (nextTo) setAssetTo(nextTo)
    logosRefreshed.current = true
  }, [assets, hasHydrated, assetFrom, assetTo, setAssetFrom, setAssetTo])

  // Sync URL on user-driven asset changes (skip the first sync after init so `/` stays clean)
  useEffect(() => {
    if (!initialized.current || !assetFrom || !assetTo) return
    if (skipNextSync.current) {
      skipNextSync.current = false
      return
    }
    const newPath = `/${SELL}${toSlug(assetFrom)}${BUY}${toSlug(assetTo)}`
    const newUrl = `${newPath}${window.location.search}`
    if (window.location.pathname + window.location.search !== newUrl) {
      window.history.replaceState(window.history.state, '', newUrl)
    }
  }, [assetFrom, assetTo])
}
