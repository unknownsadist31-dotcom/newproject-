import Image from 'next/image'

const providerIcon = (provider: string): string => {
  if (provider === 'THORCHAIN' || provider === 'THORCHAIN_STREAMING') return 'thorchain'
  if (provider === 'MAYACHAIN' || provider === 'MAYACHAIN_STREAMING') return 'mayachain'
  if (provider === 'NEAR') return 'near'
  if (provider === 'ONEINCH') return 'oneinch'
  return 'thorchain'
}

const providerLabel = (provider: string): string => {
  if (provider === 'THORCHAIN' || provider === 'THORCHAIN_STREAMING') return 'THORChain'
  if (provider === 'MAYACHAIN' || provider === 'MAYACHAIN_STREAMING') return 'Maya Protocol'
  if (provider === 'NEAR') return 'Near'
  if (provider === 'ONEINCH') return '1inch'
  return provider || 'Unknown'
}

export const SwapProvider = ({ provider }: { provider: string }) => {
  const icon = providerIcon(provider)

  return (
    <div className="flex items-center gap-2">
      <Image src={`/providers/${icon}.svg`} alt="" width="16" height="16" />
      <span className="text-txt-high-contrast font-semibold">{providerLabel(provider)}</span>
    </div>
  )
}

export { providerLabel }
