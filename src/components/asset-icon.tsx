'use client'

import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { Asset } from '@/components/swap/asset'
import { isNativeGasAsset, networkIconPath, normalizeLogoURI } from '@/lib/logo-uri'
import { cn } from '@/lib/utils'

export function AssetIcon({ asset, className }: { asset: Asset | undefined; className?: string }) {
  const [remoteFailed, setRemoteFailed] = useState(false)
  const [localFailed, setLocalFailed] = useState(false)

  const l1Chain = asset?.isSecuredAsset ? asset.identifier.split('-')[0] : asset?.chain
  const isNative = !!(l1Chain && asset?.ticker && isNativeGasAsset(l1Chain, asset.ticker))
  const remoteLogo = useMemo(() => normalizeLogoURI(asset?.logoURI), [asset?.logoURI])
  const localLogo = useMemo(() => networkIconPath(l1Chain), [l1Chain])

  useEffect(() => {
    setRemoteFailed(false)
    setLocalFailed(false)
  }, [remoteLogo, localLogo, asset?.identifier])

  // Natives: local network icon first (always available). Tokens: remote first, local fallback.
  const primarySrc = isNative
    ? !localFailed && localLogo
      ? localLogo
      : !remoteFailed && remoteLogo
        ? remoteLogo
        : undefined
    : !remoteFailed && remoteLogo
      ? remoteLogo
      : !localFailed && localLogo
        ? localLogo
        : undefined

  const showNetworkBadge = !!(l1Chain && localLogo && !isNative && primarySrc && primarySrc !== localLogo && !localFailed)
  const showLetterFallback = !!(asset && !primarySrc)

  return (
    <div className={cn('relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/10 dark:bg-white/10', className)}>
      {asset && primarySrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={primarySrc}
          className="h-full w-full shrink-0 rounded-full object-cover"
          src={primarySrc}
          alt={asset.ticker}
          width={32}
          height={32}
          onError={() => {
            if (primarySrc === remoteLogo) setRemoteFailed(true)
            else setLocalFailed(true)
          }}
        />
      )}
      {showLetterFallback && (
        <span className="text-txt-high-contrast text-[10px] font-bold uppercase leading-none">
          {(asset.ticker || '?').slice(0, 3)}
        </span>
      )}
      {showNetworkBadge && (
        <Image
          className={cn(
            'outline-swap-global bg-swap-global absolute -right-1 h-4 w-4 rounded-md',
            asset?.isSecuredAsset ? '-top-1' : '-bottom-1'
          )}
          src={localLogo!}
          alt=""
          width={16}
          height={16}
          onError={() => setLocalFailed(true)}
        />
      )}
      {asset?.isSecuredAsset && (
        <Image
          className="outline-swap-global bg-swap-global absolute -right-1 -bottom-1 h-4 w-4 rounded-md"
          src="/networks/thor.svg"
          alt="thor"
          width={16}
          height={16}
        />
      )}
    </div>
  )
}
