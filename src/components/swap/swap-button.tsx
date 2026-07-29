import { useTranslations } from 'next-intl'
import { LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { chainLabel } from '@/components/connect-wallet/config'
import { ConnectWallet } from '@/components/connect-wallet/connect-wallet'
import { useDialog } from '@/components/global-dialog'
import { InstantSwapDialog } from '@/components/swap/instant-swap-dialog'
import { SwapDialog } from '@/components/swap/swap-dialog'
import { ThemeButton } from '@/components/theme-button'
import { useBalance } from '@/hooks/use-balance'
import { useMimir } from '@/hooks/use-mimir'
import { useQuote } from '@/hooks/use-quote'
import { useSimulation } from '@/hooks/use-simulation'
import { useAssetFrom, useAssetTo, useSwap } from '@/hooks/use-swap'
import { useExternalWalletMode, useSelectedAccount, useSetExternalWalletMode } from '@/hooks/use-wallets'
import { useIsLimitSwap, useLimitSwapBuyAmount } from '@/store/limit-swap-store'

interface SwapButtonProps {
  instantSwapSupported: boolean
  instantSwapAvailable: boolean
}

interface ButtonState {
  text: string
  spinner: boolean
  accent: boolean
  onClick?: () => void
}

export const SwapButton = ({ instantSwapSupported, instantSwapAvailable }: SwapButtonProps) => {
  const t = useTranslations('swap')
  const tWallet = useTranslations('wallet')
  const assetFrom = useAssetFrom()
  const assetTo = useAssetTo()
  const selectedAccount = useSelectedAccount()
  const isLimitSwap = useIsLimitSwap()
  const limitSwapBuyAmount = useLimitSwapBuyAmount()
  const externalWalletMode = useExternalWalletMode()
  const setExternalWalletMode = useSetExternalWalletMode()
  const { valueFrom } = useSwap()
  const { quote, isLoading: isQuoting } = useQuote()
  const { isLoading: isSimulating, approveData } = useSimulation()
  const { balance, isLoading: isBalanceLoading } = useBalance()
  const { mimir } = useMimir()

  const isMayaChain = quote?.providers[0] === 'MAYACHAIN' || quote?.providers[0] === 'MAYACHAIN_STREAMING'
  const isLimitSwapDisabled = mimir['ENABLEADVSWAPQUEUE'] === 2 || isMayaChain

  const { openDialog } = useDialog()

  const onSwap = () => {
    if (!quote) return
    openDialog(SwapDialog, { provider: quote.providers[0] })
  }

  const onInstantSwap = () => {
    if (!quote) return
    openDialog(InstantSwapDialog, { provider: quote.providers[0] })
  }

  const getState = (): ButtonState => {
    if (isLimitSwap && isLimitSwapDisabled) {
      return {
        text: isMayaChain ? t('button.limitNotSupported') : t('button.temporarilyUnavailable'),
        spinner: false,
        accent: false
      }
    }

    if (!assetFrom || !assetTo) return { text: '', spinner: true, accent: false }

    if (valueFrom.eqValue(0)) return { text: t('button.enterAmount'), spinner: false, accent: false }

    if (isQuoting || isSimulating) return { text: t('button.quoting'), spinner: true, accent: false }

    if (isLimitSwap && limitSwapBuyAmount === '0') {
      return { text: t('button.enterLimitPrice'), spinner: false, accent: false }
    }

    // No route from main THORSwap/THORNode: match THORSwap and prompt Connect on the buy chain
    // so destination accounts can be linked for Instant / external flows.
    if (!quote) {
      return {
        text: t('button.connectWallet', { chain: chainLabel(assetTo.chain) }),
        spinner: false,
        accent: false,
        onClick: () => {
          if (externalWalletMode) {
            toast.warning(tWallet('externalWalletAssetUnsupported'))
            setExternalWalletMode(false)
          }
          openDialog(ConnectWallet, { chain: assetTo.chain })
        }
      }
    }

    if (!selectedAccount) {
      // SOL/XMR deposit quotes + normal Instant Swap: recipient → confirm → send+QR
      const isDepositQuote = !!quote?.meta?.isDepositQuote || quote?.providers[0] === 'SYNTHETIC'
      if (instantSwapSupported || isDepositQuote) {
        const label = isLimitSwap ? t('button.enterLimitOrder') : t('button.swap')
        if (isDepositQuote) {
          return { text: label, spinner: false, accent: true, onClick: () => onInstantSwap() }
        }
        if (!instantSwapAvailable) {
          return { text: label, spinner: false, accent: false }
        }
        return { text: label, spinner: false, accent: true, onClick: () => onInstantSwap() }
      } else {
        return {
          text: t('button.connectWallet', { chain: chainLabel(assetFrom.chain) }),
          spinner: false,
          accent: false,
          onClick: () => {
            if (externalWalletMode) {
              toast.warning(tWallet('externalWalletAssetUnsupported'))
              setExternalWalletMode(false)
            }
            openDialog(ConnectWallet, { chain: assetFrom.chain })
          }
        }
      }
    }

    if (isBalanceLoading || !balance || balance.spendable.lt(valueFrom)) {
      return {
        text: t('button.insufficientBalance'),
        spinner: false,
        accent: false
      }
    }

    if (approveData) {
      return {
        text: t('button.approve', { ticker: assetFrom.ticker }),
        spinner: false,
        accent: false,
        onClick: async () => {
          // Approval flow handled by the wallet
          const promise = Promise.resolve().then(() => {
            // TODO: implement token approval with the connected wallet
            console.log('Token approval needed')
          })

          toast.promise(promise, {
            loading: t('toast.approvalTransaction'),
            success: t('toast.success'),
            error: (err: any) => err.message || t('toast.errorSubmitting')
          })
        }
      }
    }

    return {
      text: isLimitSwap ? t('button.enterLimitOrder') : t('button.swap'),
      spinner: false,
      accent: true,
      onClick: () => onSwap()
    }
  }

  const state = getState()

  return (
    <ThemeButton
      variant={state.accent ? 'primaryMedium' : 'secondaryMedium'}
      className="rounded-15 w-full"
      onClick={state.onClick}
      disabled={!state.onClick}
    >
      {state.spinner && <LoaderCircle size={20} className="animate-spin" />}
      {state.text}
    </ThemeButton>
  )
}
