export const AppConfig = {
  id: 'thorswap',
  title: 'THORSwap | Cross-Chain BTC, ETH, SOL, XMR & Crypto Swaps',
  description:
    'Swap Bitcoin, Solana, Monero, Ethereum and other cryptocurrencies instantly with THORChain. Native cross-chain swaps with no bridges, wrapping, or centralized exchanges.',
  baseUrl: 'https://swap.thorchain.org',
  providers: ['THORCHAIN', 'MAYACHAIN'] as const,
  favicon: '/favicon.ico',
  logo: '/logo.svg',
  logoLink: 'https://www.thorchain.org',
  gtag: 'G-VZ0FQ1WC7G',
  pixelId: 'qki4a',
  pixelEvent: 'tw-qki4a-qop3i',
  discordLink: 'https://discord.gg/thorchaincommunity',
  telegramLink: 'https://t.me/thorchain_org',
  privacyPolicyLink: 'https://www.thorchain.org/privacy-policy',
  tosLink: 'https://www.thorchain.org/terms-of-use',
  supportEmail: 'contact@thorchain.org',
  // THORSwap API configuration
  thorswapApiUrl: 'https://api.thorswap.net/aggregator/tokens/quote',
  thorswapTokenListUrl: 'https://api.thorswap.net/tokenlist'
}

export const PRIMARY_HOST = 'swap.thorchain.org'

export const SUBDOMAIN_ROUTES = [
  { path: '/tcy', host: 'tcy.thorchain.org' },
  { path: '/bond', host: 'bond.thorchain.org' },
  { path: '/memo', host: 'memo.thorchain.org' },
  { path: '/pool', host: 'pool.thorchain.org' },
  { path: '/thorname', host: 'thorname.thorchain.org' }
] as const

// Chain identifiers used in the app
export const SUPPORTED_CHAINS = [
  'ARB', 'AVAX', 'BASE', 'BCH', 'BSC', 'BTC', 'COSMOS', 'DASH', 'DOGE',
  'ETH', 'LTC', 'MAYA', 'SOL', 'THOR', 'TRON', 'XRP', 'ZEC', 'XMR'
] as const

export type SupportedChain = typeof SUPPORTED_CHAINS[number]

export const CHAIN_LABELS: Record<string, string> = {
  ARB: 'Arbitrum',
  AVAX: 'Avalanche',
  BASE: 'Base',
  BCH: 'Bitcoin Cash',
  BSC: 'BNB Smart Chain',
  BTC: 'Bitcoin',
  COSMOS: 'Cosmos',
  DASH: 'Dash',
  DOGE: 'Dogecoin',
  ETH: 'Ethereum',
  LTC: 'Litecoin',
  MAYA: 'Maya Protocol',
  SOL: 'Solana',
  THOR: 'THORChain',
  TRON: 'TRON',
  XRP: 'XRP Ledger',
  ZEC: 'Zcash',
  XMR: 'Monero'
}

export const CHAIN_ASSET_MAP: Record<string, string> = {
  ARB: 'ARB.ETH',
  AVAX: 'AVAX.AVAX',
  BASE: 'BASE.ETH',
  BCH: 'BCH.BCH',
  BSC: 'BSC.BNB',
  BTC: 'BTC.BTC',
  COSMOS: 'GAIA.ATOM',
  DASH: 'DASH.DASH',
  DOGE: 'DOGE.DOGE',
  ETH: 'ETH.ETH',
  LTC: 'LTC.LTC',
  MAYA: 'MAYA.CACAO',
  SOL: 'SOL.SOL',
  THOR: 'THOR.RUNE',
  TRON: 'TRON.TRX',
  XRP: 'XRP.XRP',
  ZEC: 'ZEC.ZEC',
  XMR: 'XMR.XMR'
}
