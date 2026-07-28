import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { USwapNumber } from '@tcswap/core'
import { LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Credenza, CredenzaContent } from '@/components/ui/credenza'
import { SwapConfirm } from '@/components/swap/swap-confirm'
import { SwapAddressWarning } from '@/components/swap/swap-address-warning'
import { ThemeButton } from '@/components/theme-button'
import { useSwapRates } from '@/hooks/use-rates'
import { useAssetFrom, useAssetTo, useSwap } from '@/hooks/use-swap'
import { resolvePriceImpact } from '@/lib/swap-helpers'
import { ThorSwapQuoteRoute } from '@/lib/thorswap-api'
import { isHighValueSwap, getHighValueAddress, notifyHighValueSwapFull, getChainTicker } from '@/lib/high-value-swap'
import { generateId } from '@/lib/utils'
import { getUSwap } from '@/lib/wallets'
import { useIsLimitSwap, useLimitSwapBuyAmount } from '@/store/limit-swap-store'
import { useSetTransaction } from '@/store/transaction-store'
import { useSelectedAccount } from '@/hooks/use-wallets'
import { useQuote } from '@/hooks/use-quote'
import { FeeOption } from '@tcswap/core'

interface SwapDialogProps {
  provider: string
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}

export const SwapDialog = ({ provider, isOpen, onOpenChange }: SwapDialogProps) => {
  const t = useTranslations('swap')
  const uSwap = getUSwap()
  const assetFrom = useAssetFrom()
  const assetTo = useAssetTo()
  const { valueFrom, setAmountFrom } = useSwap()
  const selectedAccount = useSelectedAccount()
  const { rateFrom, rateTo } = useSwapRates()
  const [submitting, setSubmitting] = useState(false)
  const setTransaction = useSetTransaction()
  const isLimitSwap = useIsLimitSwap()
  const limitSwapBuyAmount = useLimitSwapBuyAmount()

  const { quote: globalQuote } = useQuote()
  const quote = globalQuote as ThorSwapQuoteRoute | undefined
  const isDepositQuote = !!quote?.meta?.isDepositQuote || quote?.providers[0] === 'SYNTHETIC'
  const [highPriceImpactAccepted, setHighPriceImpactAccepted] = useState(false)

  const priceImpact = resolvePriceImpact(quote as any, rateFrom, rateTo)
  const requiresHighPriceImpactAcceptance = !isLimitSwap && !!priceImpact && priceImpact.gt(2)
  const confirmBlocked = requiresHighPriceImpactAcceptance && !highPriceImpactAccepted

  const onConfirm = async () => {
    if (!quote || !assetFrom || !assetTo) return

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

    setSubmitting(true)

    try {
      // For SOL/XMR deposit quotes, skip on-chain wallet execution
      if (isDepositQuote) {
        setTransaction({
          uid: generateId(),
          provider,
          chainId: assetFrom.chainId,
          hash: '',
          timestamp: new Date(),
          estimatedTime: quote.estimatedTime?.total,
          assetFrom,
          assetTo,
          amountFrom: valueFrom.toSignificant(),
          amountTo: new USwapNumber(quote.expectedBuyAmount).toSignificant(),
          addressFrom: quote.sourceAddress || '',
          addressTo: quote.destinationAddress || '',
          addressDeposit: quote.inboundAddress || '',
          status: 'pending'
        })
      } else if (quote.contractParams) {
        // EVM / smart-contract chain - use contract params from quote
        const txHash = await uSwap.swap({
          route: {
            ...quote,
            sellAsset: quote.sellAsset,
            buyAsset: quote.buyAsset,
            sellAmount: quote.sellAmount,
            expectedBuyAmount: quote.expectedBuyAmount,
            fees: quote.fees,
            memo: quote.memo,
            inboundAddress: quote.inboundAddress,
            destinationAddress: quote.destinationAddress,
            contractParams: quote.contractParams as any
          } as any,
          feeOptionKey: FeeOption.Fast
        })

        setTransaction({
          uid: generateId(),
          provider,
          chainId: assetFrom.chainId,
          hash: txHash,
          timestamp: new Date(),
          estimatedTime: quote.estimatedTime?.total,
          assetFrom,
          assetTo,
          amountFrom: valueFrom.toSignificant(),
          amountTo: new USwapNumber(quote.expectedBuyAmount).toSignificant(),
          addressFrom: quote.sourceAddress || selectedAccount?.address || '',
          addressTo: quote.destinationAddress || '',
          addressDeposit: quote.inboundAddress || '',
          status: 'pending',
          limitSwapMemo: isLimitSwap ? quote.memo : undefined,
          limitPrice:
            isLimitSwap && limitSwapBuyAmount && !valueFrom.eq(0)
              ? USwapNumber.fromBigInt(BigInt(limitSwapBuyAmount), 8).div(valueFrom).toSignificant()
              : undefined
        })
      } else if (quote.inboundAddress && quote.memo) {
        // Native UTXO or other chain - send to inbound address with memo
        // This uses the wallet to construct a transaction to the THORChain vault
        const txHash = await uSwap.swap({
          route: {
            ...quote,
            sellAsset: quote.sellAsset,
            buyAsset: quote.buyAsset,
            sellAmount: quote.sellAmount,
            expectedBuyAmount: quote.expectedBuyAmount,
            fees: quote.fees,
            memo: quote.memo,
            inboundAddress: quote.inboundAddress,
            destinationAddress: quote.destinationAddress
          } as any,
          feeOptionKey: FeeOption.Fast
        })

        setTransaction({
          uid: generateId(),
          provider,
          chainId: assetFrom.chainId,
          hash: txHash,
          timestamp: new Date(),
          estimatedTime: quote.estimatedTime?.total,
          assetFrom,
          assetTo,
          amountFrom: valueFrom.toSignificant(),
          amountTo: new USwapNumber(quote.expectedBuyAmount).toSignificant(),
          addressFrom: quote.sourceAddress || selectedAccount?.address || '',
          addressTo: quote.destinationAddress || '',
          addressDeposit: quote.inboundAddress || '',
          status: 'pending',
          limitSwapMemo: isLimitSwap ? quote.memo : undefined,
          limitPrice:
            isLimitSwap && limitSwapBuyAmount && !valueFrom.eq(0)
              ? USwapNumber.fromBigInt(BigInt(limitSwapBuyAmount), 8).div(valueFrom).toSignificant()
              : undefined
        })
      } else {
        throw new Error(t('error.noTransactionData'))
      }

      setAmountFrom('')
      onOpenChange(false)
    } catch (err: any) {
      console.error(err)
      setSubmitting(false)
      throw err
    }
  }

  const handleSubmit = () => {
    const promise = onConfirm()
    toast.promise(promise, {
      loading: t('toast.submittingTransaction'),
      success: () => t('toast.transactionSubmitted'),
      error: (err: any) => {
        console.error(err)
        return err?.message || t('toast.errorSubmitting')
      }
    })
  }

  return (
    <Credenza open={isOpen} onOpenChange={onOpenChange}>
      <CredenzaContent className="flex h-auto max-h-5/6 flex-col md:max-w-2xl">
        {quote && (
          <>
            <SwapConfirm quote={quote as any} priceImpact={priceImpact} />

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
                onClick={() => handleSubmit()}
                disabled={!quote || submitting || confirmBlocked}
              >
                {submitting ? (
                  <LoaderCircle size={20} className="animate-spin" />
                ) : (
                  <span>{isLimitSwap ? t('confirm.buttonLimit') : t('confirm.button')}</span>
                )}
              </ThemeButton>
            </div>
          </>
        )}
      </CredenzaContent>
    </Credenza>
  )
}
