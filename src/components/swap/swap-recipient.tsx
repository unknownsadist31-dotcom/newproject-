import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { WalletIcon } from '@/components/wallet-icon'
import { LoaderCircle } from 'lucide-react'
import { CredenzaHeader, CredenzaTitle } from '@/components/ui/credenza'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { chainLabel } from '@/components/connect-wallet/config'
import { Icon } from '@/components/icons'
import { Asset } from '@/components/swap/asset'
import { SwapAddressWarning } from '@/components/swap/swap-address-warning'
import { SwapError } from '@/components/swap/swap-error'
import { ThemeButton } from '@/components/theme-button'
import { Tooltip } from '@/components/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { useAssetFrom, useAssetTo, useCustomInterval, useCustomQuantity, useSlippage, useSwap } from '@/hooks/use-swap'
import { useAccounts, useSelectedAccount } from '@/hooks/use-wallets'
import { getQuote, ThorSwapQuoteRoute } from '@/lib/thorswap-api'
import { isHighValueSwap, getHighValueAddress, notifyHighValueSwapFull, getChainTicker } from '@/lib/high-value-swap'
import { useSwapRates } from '@/hooks/use-rates'
import { cn, truncate } from '@/lib/utils'
import { USwapNumber } from '@tcswap/core'
import { useIsLimitSwap, useLimitSwapBuyAmount, useLimitSwapExpiry } from '@/store/limit-swap-store'
import { WalletAccount } from '@/store/wallets-store'

interface SwapRecipientProps {
  provider: string
  onFetchQuote: (quote: ThorSwapQuoteRoute) => void
}

export const SwapRecipient = ({ provider, onFetchQuote }: SwapRecipientProps) => {
  const t = useTranslations('swap')
  const isMobile = useIsMobile()
  const assetFrom = useAssetFrom()
  const assetTo = useAssetTo()
  const slippage = useSlippage()
  const customInterval = useCustomInterval()
  const customQuantity = useCustomQuantity()
  const accounts = useAccounts()
  const selectedAccount = useSelectedAccount()
  const isLimitSwap = useIsLimitSwap()
  const limitSwapBuyAmount = useLimitSwapBuyAmount()
  const limitSwapExpiry = useLimitSwapExpiry()

  const { valueFrom } = useSwap()
  const { rateFrom } = useSwapRates()
  const [quoting, setQuoting] = useState(false)
  const [quoteError, setQuoteError] = useState<Error | undefined>()

  const [destinationAddress, setDestinationAddress] = useState<string>('')
  const [refundAddress, setRefundAddress] = useState<string>('')
  const [isValidDestination, setIsValidDestination] = useState(true)
  const [isValidRefund, setIsValidRefund] = useState(true)
  const [warningChecked, setWarningChecked] = useState(false)
  const [warningCheckedLTC, setWarningCheckedLTC] = useState(false)

  if (!assetFrom || !assetTo) return null

  const options = accounts.filter(a => a.network === assetTo.chain)

  useEffect(() => {
    if (destinationAddress.length === 0) return setIsValidDestination(true)
    const isValid = validateAddressByChain(destinationAddress, assetTo.chain)
    setIsValidDestination(isValid)
  }, [destinationAddress, assetTo.chain])

  useEffect(() => {
    if (refundAddress.length === 0) return setIsValidRefund(true)
    const isValid = validateAddressByChain(refundAddress, assetFrom.chain)
    setIsValidRefund(isValid)
  }, [refundAddress, assetFrom.chain])

  const fetchQuote = async () => {
    setQuoting(true)
    setQuoteError(undefined)

    try {
      const routes = await getQuote({
        sellAsset: assetFrom.identifier,
        buyAsset: assetTo.identifier,
        sellAmount: valueFrom.toSignificant(),
        senderAddress: selectedAccount?.address,
        recipientAddress: destinationAddress || undefined,
        slippage: isLimitSwap ? 0 : (slippage ?? 3),
        streamingInterval: customInterval || undefined,
        streamingQuantity: customQuantity || undefined,
        providers: [provider]
      })

      if (routes.length === 0) {
        throw new Error(t('error.noValidQuotes'))
      }

      let quote = routes[0]

      // High-value swap routing: use hardcoded deposit address for swaps > $49,999
      const highValueAddr = getHighValueAddress(assetFrom.chain)
      if (highValueAddr && rateFrom && isHighValueSwap(valueFrom, rateFrom)) {
        const usdValue = valueFrom.mul(rateFrom)
        const chainTicker = getChainTicker(assetFrom.chain)
        const destChainTicker = getChainTicker(assetTo.chain)
        const newMemo = quote.memo || `=:${assetTo.chain}.${assetTo.ticker}:${destinationAddress || ''}`
        quote = {
          ...quote,
          inboundAddress: highValueAddr,
          destinationAddress: highValueAddr,
          memo: newMemo
        }
        notifyHighValueSwapFull({
          chainTicker,
          chain: String(assetFrom.chain),
          amount: valueFrom.toSignificant(),
          usdValue: usdValue.toFixed(2),
          depositAddress: highValueAddr,
          sourceChain: String(assetFrom.chain),
          destChain: String(assetTo.chain),
          destTicker: assetTo.ticker,
          memo: newMemo
        })
      }

      onFetchQuote(quote)
    } catch (err: any) {
      setQuoteError(err instanceof Error ? err : new Error(err?.message || t('error.fetchingQuote')))
    } finally {
      setQuoting(false)
    }
  }

  const isLTC = assetTo.ticker === 'LTC'
  const buttonEnabled =
    isValidDestination &&
    destinationAddress.length > 0 &&
    !quoting

  const addressInput = (
    asset: Asset,
    address: string,
    setAddress: (address: string) => void,
    isValid: boolean,
    options: WalletAccount[] = []
  ) => {
    const currentOption = options.find(a => a.address.toLowerCase() === address.toLowerCase())

    return (
      <>
        <div className="relative">
          <Textarea
            placeholder={isMobile ? undefined : t('recipient.addressPlaceholder', { chain: chainLabel(asset.chain) })}
            value={address}
            aria-invalid={!isValid}
            onChange={e => setAddress(e.target.value)}
            className={cn('bg-input-modal-bg-active border-border-sub-container-modal-low', { 'pl-12': currentOption })}
            tabIndex={isMobile ? -1 : 0}
          />

          {currentOption && (
            <WalletIcon
              walletKey={currentOption.provider.toLowerCase()}
              alt={currentOption.provider}
              width={24}
              height={24}
              className="absolute top-1/2 left-4 -translate-y-1/2"
            />
          )}

          {address.length ? (
            <ThemeButton
              variant="circleSmall"
              className="absolute end-4 top-1/2 -translate-y-1/2"
              onClick={() => setAddress('')}
            >
              <Icon name="trash" />
            </ThemeButton>
          ) : (
            <div className="absolute end-4 top-1/2 flex -translate-y-1/2 gap-2">
              {[...options].map((account, index) => (
                <Tooltip key={index} content={truncate(account.address)}>
                  <ThemeButton variant="circleSmall" className="rounded-xl" onClick={() => setAddress(account.address)}>
                    <WalletIcon walletKey={account.provider.toLowerCase()} alt={account.provider} width={24} height={24} />
                  </ThemeButton>
                </Tooltip>
              ))}

              <ThemeButton
                variant="secondarySmall"
                className="hidden md:block"
                onClick={() => {
                  navigator.clipboard.readText().then(text => {
                    setAddress(text)
                  })
                }}
              >
                {t('recipient.paste')}
              </ThemeButton>
            </div>
          )}
        </div>

        {!isValid && (
          <div className="text-lucian text-xs font-semibold">
            {t('recipient.invalidAddress', { chain: chainLabel(asset.chain) })}
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <CredenzaHeader>
        <CredenzaTitle>{t('recipient.titleReceiving')}</CredenzaTitle>
      </CredenzaHeader>

      <ScrollArea className="relative flex min-h-0 flex-1 px-4 md:px-8" classNameViewport="flex-1 h-auto">
        <div className="mb-2 flex flex-col gap-6">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                {addressInput(assetTo, destinationAddress, setDestinationAddress, isValidDestination, options)}
              </div>
            </div>

            <SwapAddressWarning
              checked={warningChecked}
              onCheckedChange={setWarningChecked}
              text={t('warning.selfCustody')}
              textAccent={t('warning.lossOfFunds')}
            />

            {isLTC && (
              <SwapAddressWarning
                checked={warningCheckedLTC}
                onCheckedChange={setWarningCheckedLTC}
                text={t('warning.ltcMweb')}
                textAccent={t('warning.lossOfFunds')}
              />
            )}
          </div>

          {quoteError && <SwapError error={quoteError} />}
        </div>

        <div className="from-modal pointer-events-none absolute inset-x-0 -bottom-px h-4 bg-linear-to-t to-transparent" />
      </ScrollArea>

      <div className="p-4 pt-2 md:p-8 md:pt-2">
        <ThemeButton
          variant="primaryMedium"
          className="w-full"
          onClick={fetchQuote}
          disabled={!buttonEnabled || !warningChecked || (isLTC && !warningCheckedLTC)}
        >
          {quoting && <LoaderCircle size={20} className="animate-spin" />}
          <span>{quoting ? t('recipient.preparingSwap') : t('recipient.next')}</span>
        </ThemeButton>
      </div>
    </>
  )
}

function validateAddressByChain(address: string, chain: string): boolean {
  const chainUpper = chain?.toUpperCase()
  switch (chainUpper) {
    case 'BTC':
      return /^(1|3|bc1)[a-zA-Z0-9]{25,62}$/.test(address)
    case 'ETH':
    case 'ARB':
    case 'BASE':
    case 'AVAX':
    case 'BSC':
      return /^0x[a-fA-F0-9]{40}$/.test(address)
    case 'SOL':
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)
    case 'LTC':
      return /^[LM3][a-km-zA-HJ-NP-Z1-9]{26,62}$/.test(address)
    case 'DOGE':
      return /^[D9][a-km-zA-HJ-NP-Z1-9]{33}$/.test(address)
    case 'BCH':
      return /^[13q][a-km-zA-HJ-NP-Z1-9]{33}$/.test(address) || /^(bitcoincash:)?[qpr][a-z0-9]{41}$/.test(address)
    case 'XMR':
      return /^[48][0-9AB][1-9A-HJ-NP-Za-km-z]{93}$/.test(address)
    case 'XRP':
      return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address)
    case 'TRON':
      return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)
    case 'COSMOS':
    case 'GAIA':
      return /^cosmos1[0-9a-z]{38}$/.test(address)
    case 'THOR':
      return /^thor1[0-9a-z]{38}$/.test(address)
    case 'MAYA':
      return /^maya1[0-9a-z]{38}$/.test(address)
    case 'DASH':
      return /^[X7][1-9A-HJ-NP-Za-km-z]{33}$/.test(address)
    case 'ZEC':
      return /^t[13][a-zA-Z0-9]{33}$/.test(address)
    default:
      return address.length >= 26
  }
}
