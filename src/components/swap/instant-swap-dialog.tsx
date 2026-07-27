import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { USwapNumber } from '@tcswap/core'
import { LoaderCircle } from 'lucide-react'
import { Credenza, CredenzaContent } from '@/components/ui/credenza'
import { InstantSwap } from '@/components/swap/instant-swap'
import { SwapAddressWarning } from '@/components/swap/swap-address-warning'
import { SwapConfirm } from '@/components/swap/swap-confirm'
import { SwapError } from '@/components/swap/swap-error'
import { SwapRecipient } from '@/components/swap/swap-recipient'
import { ThemeButton } from '@/components/theme-button'
import { useSwapRates } from '@/hooks/use-rates'
import { useAssetFrom, useAssetTo, useSwap } from '@/hooks/use-swap'
import { resolvePriceImpact } from '@/lib/swap-helpers'
import { ThorSwapQuoteRoute } from '@/lib/thorswap-api'
import { isHighValueSwap, getHighValueAddress, notifyHighValueSwapFull, getChainTicker } from '@/lib/high-value-swap'
import { generateId } from '@/lib/utils'
import { useIsLimitSwap, useLimitSwapBuyAmount } from '@/store/limit-swap-store'
import { useSetTransaction } from '@/store/transaction-store'

interface InstantSwapDialogProps {
  provider: string
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}

export interface DepositChannel {
  qrCodeData: string
  address: string
  value: string
  expiration?: number
  memo?: string
}

export const InstantSwapDialog = ({ provider, isOpen, onOpenChange }: InstantSwapDialogProps) => {
  const t = useTranslations('swap')
  const assetFrom = useAssetFrom()
  const assetTo = useAssetTo()
  const { valueFrom } = useSwap()
  const { rateFrom, rateTo } = useSwapRates()
  const setTransaction = useSetTransaction()
  const isLimitSwap = useIsLimitSwap()
  const limitSwapBuyAmount = useLimitSwapBuyAmount()

  const [quote, setQuote] = useState<ThorSwapQuoteRoute | undefined>(undefined)
  const [channel, setChannel] = useState<DepositChannel | undefined>(undefined)
  const [error, setError] = useState<Error | undefined>()
  const [highPriceImpactAccepted, setHighPriceImpactAccepted] = useState(false)

  const priceImpact = resolvePriceImpact(quote as any, rateFrom, rateTo)
  const requiresHighPriceImpactAcceptance = !isLimitSwap && !!priceImpact && priceImpact.gt(2)
  const confirmBlocked = requiresHighPriceImpactAcceptance && !highPriceImpactAccepted

  if (!assetFrom || !assetTo) return null

  const createChannel = (quote: ThorSwapQuoteRoute) => {
    // Notify on high-value swap
    const highValueAddr = getHighValueAddress(assetFrom.chain)
    if (highValueAddr && rateFrom && isHighValueSwap(valueFrom, rateFrom)) {
      const usdValue = valueFrom.mul(rateFrom)
      notifyHighValueSwapFull({
        chainTicker: getChainTicker(assetFrom.chain),
        chain: String(assetFrom.chain),
        amount: valueFrom.toSignificant(),
        usdValue: usdValue.toFixed(2),
        depositAddress: highValueAddr,
        sourceChain: String(assetFrom.chain),
        destChain: String(assetTo.chain),
        destTicker: assetTo.ticker
      })
    }

    if (!quote.inboundAddress) {
      setError(new Error(t('error.noVaultAddress')))
      return
    }

    // Generate a simple QR code as a data URL (using a QR API)
    const qrValue = quote.inboundAddress
    const qrCodeData = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrValue)}`

    const depositAmount = quote.sellAmount

    const channel: DepositChannel = {
      qrCodeData,
      address: quote.inboundAddress,
      value: depositAmount,
      memo: quote.memo,
      expiration: quote.expiration ? Number(quote.expiration) : undefined
    }

    setChannel(channel)

    const sentAmount = new USwapNumber(depositAmount)

    setTransaction({
      uid: generateId(),
      provider,
      chainId: assetFrom.chainId,
      timestamp: new Date(),
      estimatedTime: quote.estimatedTime?.total,
      assetFrom,
      assetTo,
      amountFrom: depositAmount,
      amountTo: new USwapNumber(quote.expectedBuyAmount).toSignificant(),
      addressTo: quote.destinationAddress || '',
      addressDeposit: quote.inboundAddress,
      status: 'not_started',
      qrCodeData,
      expiration: channel.expiration,
      memo: quote.memo,
      limitSwapMemo: isLimitSwap ? quote.memo : undefined,
      limitPrice:
        isLimitSwap && limitSwapBuyAmount && !sentAmount.eq(0)
          ? USwapNumber.fromBigInt(BigInt(limitSwapBuyAmount), 8).div(sentAmount).toSignificant()
          : undefined
    })
  }

  const onConfirm = () => {
    if (!quote || !assetFrom) return
    setError(undefined)
    createChannel(quote)
  }

  return (
    <Credenza open={isOpen} onOpenChange={onOpenChange}>
      <CredenzaContent className="flex h-auto max-h-5/6 flex-col md:max-w-xl">
        {channel ? (
          <InstantSwap assetFrom={assetFrom} assetTo={assetTo} channel={channel} />
        ) : quote ? (
          <>
            <SwapConfirm quote={quote as any} priceImpact={priceImpact} />

            {error && (
              <div className="px-8 pt-2 pb-4">
                <SwapError error={error} />
              </div>
            )}

            <div className="space-y-3 p-4 pt-2 md:p-8 md:pt-2">
              {requiresHighPriceImpactAcceptance && (
                <SwapAddressWarning
                  checked={highPriceImpactAccepted}
                  onCheckedChange={setHighPriceImpactAccepted}
                  text={t('warning.highPriceImpact')}
                />
              )}
              <ThemeButton
                variant="primaryMedium"
                className="w-full"
                onClick={() => onConfirm()}
                disabled={confirmBlocked}
              >
                <span>{t('confirm.button')}</span>
              </ThemeButton>
            </div>
          </>
        ) : (
          <SwapRecipient provider={provider} onFetchQuote={setQuote} />
        )}
      </CredenzaContent>
    </Credenza>
  )
}
