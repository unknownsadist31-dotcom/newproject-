'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { WalletOption } from '@tcswap/core'
import { WalletIcon } from '@/components/wallet-icon'
import { Credenza, CredenzaContent, CredenzaHeader, CredenzaTitle } from '@/components/ui/credenza'
import { ScrollArea } from '@/components/ui/scroll-area'
import { wallet, WALLETS } from '@/components/connect-wallet/config'
import { tokenToAsset } from '@/components/send/send-helpers'
import { TokenBalance, useWalletBalances } from '@/hooks/use-wallet-balances'
import { WalletAccount } from '@/store/wallets-store'
import { DecimalText } from '@/components/decimal/decimal-text'
import { isNativeGasAsset, networkIconPath, normalizeLogoURI } from '@/lib/logo-uri'
import { toCurrencyFixed } from '@/lib/utils'
import { CheckIcon } from 'lucide-react'

export interface SelectTokenDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  selected: TokenBalance
  selectedAccount: WalletAccount
  onSelect: (token: TokenBalance, account: WalletAccount) => void
  filter?: (token: TokenBalance) => boolean
}

function TokenLogo({ token, ticker }: { token: TokenBalance; ticker: string }) {
  const [remoteFailed, setRemoteFailed] = useState(false)
  const [localFailed, setLocalFailed] = useState(false)
  const isNative = isNativeGasAsset(token.balance.chain, token.balance.ticker)
  const remoteLogo = normalizeLogoURI(token.logoURI)
  const localLogo = networkIconPath(token.balance.chain)
  const iconUrl = isNative
    ? (!localFailed && localLogo) || (!remoteFailed && remoteLogo) || undefined
    : (!remoteFailed && remoteLogo) || (!localFailed && localLogo) || undefined

  return (
    <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-black/10 dark:bg-white/10">
      {iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={iconUrl}
          src={iconUrl}
          alt={ticker}
          width={32}
          height={32}
          className="h-full w-full rounded-full object-cover"
          onError={() => {
            if (iconUrl === remoteLogo) setRemoteFailed(true)
            else setLocalFailed(true)
          }}
        />
      ) : (
        <span className="text-txt-high-contrast text-[10px] font-bold uppercase">{(ticker || '?').slice(0, 3)}</span>
      )}
    </div>
  )
}

export function SendSelectToken({ isOpen, onOpenChange, selected, selectedAccount, onSelect, filter }: SelectTokenDialogProps) {
  const t = useTranslations('send')
  const { walletData } = useWalletBalances()

  const byProvider = walletData.reduce<Map<WalletOption, { account: WalletAccount; token: TokenBalance }[]>>((map, { account, tokens }) => {
    const entries = tokens.filter(t => t.amount > 0 && (!filter || filter(t))).map(token => ({ account, token }))
    if (!entries.length) return map
    const existing = map.get(account.provider) ?? []
    map.set(account.provider, [...existing, ...entries])
    return map
  }, new Map())

  return (
    <Credenza open={isOpen} onOpenChange={onOpenChange}>
      <CredenzaContent className="flex max-h-5/6 flex-col md:max-w-sm">
        <CredenzaHeader>
          <CredenzaTitle>{t('selectCoin')}</CredenzaTitle>
        </CredenzaHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-4 px-6 pb-6">
            {Array.from(byProvider.entries()).map(([provider, entries]) => {
              const walletInfo = wallet(provider) ?? WALLETS.find(w => w.option === provider)
              const walletKey = walletInfo?.key ?? provider.toLowerCase()
              const walletName = walletInfo?.label ?? provider

              return (
                <div key={provider} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 py-1">
                    <WalletIcon walletKey={walletKey} width={20} height={20} alt={walletName} className="shrink-0 rounded-md" />
                    <span className="text-txt-label-small text-sm font-medium">{walletName}</span>
                  </div>

                  <div className="bg-body overflow-hidden rounded-2xl">
                    {entries.map(({ token, account }, i) => {
                      const asset = tokenToAsset(token)
                      const isSelected =
                        token.balance.ticker === selected.balance.ticker &&
                        token.balance.chain === selected.balance.chain &&
                        token.balance.address === selected.balance.address &&
                        account.provider === selectedAccount.provider

                      return (
                        <div
                          key={i}
                          onClick={() => {
                            onSelect(token, account)
                            onOpenChange(false)
                          }}
                          className="hover:bg-contrast-2/50 flex cursor-pointer items-center gap-3 border-b px-4 py-3 last:border-b-0"
                        >
                          <TokenLogo token={token} ticker={asset.ticker} />
                          <div className="min-w-0 flex-1">
                            <div className="text-txt-high-contrast text-sm font-medium">{asset.ticker}</div>
                          </div>
                          <div className="flex items-center gap-2 text-right">
                            {token.usdValue !== undefined ? (
                              <div>
                                <div className="text-txt-high-contrast text-sm font-medium">
                                  {toCurrencyFixed(token.usdValue.toCurrency('$', { trimTrailingZeros: false }))}
                                </div>
                                <div className="text-txt-label-small text-xs font-medium">
                                  <DecimalText amount={token.balance.toSignificant()} symbol={asset.ticker} />
                                </div>
                              </div>
                            ) : (
                              <div className="text-txt-high-contrast text-sm font-medium">
                                <DecimalText amount={token.balance.toSignificant()} symbol={asset.ticker} />
                              </div>
                            )}
                            {isSelected && <CheckIcon className="text-green-contrast size-6" />}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </CredenzaContent>
    </Credenza>
  )
}
