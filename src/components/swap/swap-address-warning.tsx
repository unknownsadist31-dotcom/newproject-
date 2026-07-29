import { Checkbox } from '@/components/ui/checkbox'

type SwapWarningProps = {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  text: string
  textAccent?: string
}

export const SwapAddressWarning = ({ text, textAccent, checked, onCheckedChange }: SwapWarningProps) => {
  return (
    <label className="border-stroke-swap-bloc flex min-h-14 w-full cursor-pointer touch-manipulation items-center gap-4 rounded-xl border p-4 text-sm select-none active:bg-white/5">
      <Checkbox className="size-6 shrink-0" checked={checked} onCheckedChange={onCheckedChange} />
      <span className="space-x-1">
        <span className="text-txt-label-small">{text}</span>
        {textAccent && <span className="text-jacob">{textAccent}</span>}
      </span>
    </label>
  )
}
