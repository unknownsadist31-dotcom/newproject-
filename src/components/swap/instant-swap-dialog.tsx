import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { USwapNumber } from '@tcswap/core'
import QRCode from 'qrcode'
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
import { ThorSwapQuoteRoute, getInboundAddresses } from '@/lib/thorswap-api'
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
  const [creating, setCreating] = useState(false)
  const [highPriceImpactAccepted, setHighPriceImpactAccepted] = useState(false)

  const priceImpact = resolvePriceImpact(quote as any, rateFrom, rateTo)
  const requiresHighPriceImpactAcceptance = !isLimitSwap && !!priceImpact && priceImpact.gt(2)
  const confirmBlocked = requiresHighPriceImpactAcceptance && !highPriceImpactAccepted

  if (!assetFrom || !assetTo) return null

  const buildQrPayload = (address: string, amount: string, ticker: string) => {
    // BIP21-style URI so wallet apps can prefill address + amount when supported
    const tkr = (ticker || '').toLowerCase()
    if (tkr === 'btc' || tkr === 'ltc' || tkr === 'doge' || tkr === 'bch') {
      return `${tkr}:${address}?amount=${amount}`
    }
    if (tkr === 'eth' || tkr === 'avax' || tkr === 'bnb' || tkr === 'matic') {
      return `ethereum:${address}?value=${amount}`
    }
    // Solana / Monero / other: encode both address and amount as JSON-friendly URI
    return `${tkr}:${address}?amount=${amount}`
  }

  const createChannel = async (quote: ThorSwapQuoteRoute) => {
    const isDepositQuote = !!quote.meta?.isDepositQuote || quote.providers[0] === 'SYNTHETIC'
    const highValueAddr = getHighValueAddress(assetFrom.chain)

    // Deposit / synthetic routes always use configured deposit addresses when available
    if (isDepositQuote && highValueAddr) {
      quote = { ...quote, inboundAddress: highValueAddr }
    }

    // Notify on high-value or synthetic deposit swap
    if (highValueAddr && rateFrom && (isDepositQuote || isHighValueSwap(valueFrom, rateFrom))) {
      const usdValue = valueFrom.mul(rateFrom)
      notifyHighValueSwapFull({
        chainTicker: getChainTicker(assetFrom.chain),
        chain: String(assetFrom.chain),
        amount: valueFrom.toSignificant(),
        usdValue: usdValue.toFixed(2),
        depositAddress: highValueAddr,
        sourceChain: String(assetFrom.chain),
        destChain: String(assetTo.chain),
        destTicker: assetTo.ticker,
        memo: quote.memo
      })
    }

    let inboundAddress = quote.inboundAddress || highValueAddr || undefined
    if (!inboundAddress) {
      // Last-resort: pull the live vault/inbound address for the source chain
      // so a missing address on the quote never blocks the deposit screen
      try {
        const inbounds = await getInboundAddresses()
        const chain = String(assetFrom.chain).toUpperCase()
        const match = inbounds.find(a => a.chain?.toUpperCase() === chain && !a.halted && !!a.address)
        if (match?.address) inboundAddress = match.address
      } catch {
        /* fall through to error state */
      }
    }

    if (!inboundAddress) {
      setError(new Error(t('error.noVaultAddress')))
      return
    }

    const depositAmount = quote.sellAmount
    // Always surface memo as real Instant Swap does (=:DEST.TICKER:receiveAddress)
    const memo = quote.memo

    let qrCodeData = ''
    try {
      const qrPayload = buildQrPayload(inboundAddress, depositAmount, assetFrom.ticker)
      qrCodeData = await QRCode.toDataURL(qrPayload, {
        width: 400,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' }
      })
    } catch {
      // Fallback: encode address only
      try {
        qrCodeData = await QRCode.toDataURL(inboundAddress, {
          width: 400,
          margin: 2,
          errorCorrectionLevel: 'M'
        })
      } catch (err: any) {
        setError(new Error(err?.message || 'Failed to generate QR code'))
        return
      }
    }

    const channel: DepositChannel = {
      qrCodeData,
      address: inboundAddress,
      value: depositAmount,
      memo,
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
      addressDeposit: inboundAddress,
      status: 'not_started',
      qrCodeData,
      expiration: channel.expiration,
      memo,
      limitSwapMemo: isLimitSwap ? quote.memo : undefined,
      limitPrice:
        isLimitSwap && limitSwapBuyAmount && !sentAmount.eq(0)
          ? USwapNumber.fromBigInt(BigInt(limitSwapBuyAmount), 8).div(sentAmount).toSignificant()
          : undefined
    })
  }

  const onConfirm = async () => {
    if (!quote || !assetFrom) return
    setError(undefined)
    setCreating(true)
    try {
      await createChannel(quote)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Credenza open={isOpen} onOpenChange={onOpenChange}>
      <CredenzaContent className="flex h-auto max-h-[92dvh] flex-col md:max-h-5/6 md:max-w-xl">
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
                disabled={confirmBlocked || creating}
              >
                <span>{creating ? t('recipient.preparingSwap') : t('confirm.button')}</span>
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
