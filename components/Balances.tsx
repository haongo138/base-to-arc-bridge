'use client'

import { arc } from '@/lib/chains'
import { USDC_DECIMALS } from '@/lib/gateway'
import { formatUnits } from 'viem'

const fmt = (v: bigint | undefined, decimals: number) =>
  v === undefined
    ? '—'
    : Number(formatUnits(v, decimals)).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })

/**
 * Where the user's USDC currently sits. Three rows because a bridge in flight splits
 * funds across three places, and "my money vanished" is the scariest part of the ~20
 * minute finality wait.
 */
export function Balances({
  baseWallet,
  gatewayAvailable,
  gatewayPending,
  arcBalance,
}: {
  baseWallet?: bigint
  gatewayAvailable?: bigint
  gatewayPending?: bigint
  arcBalance?: bigint
}) {
  const inGateway = (gatewayAvailable ?? 0n) + (gatewayPending ?? 0n)

  return (
    <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-edge bg-edge/40 text-center">
      <Cell label="Base" value={fmt(baseWallet, USDC_DECIMALS)} />
      <Cell
        label="In Gateway"
        value={fmt(gatewayAvailable, USDC_DECIMALS)}
        note={
          gatewayPending && gatewayPending > 0n
            ? `+${fmt(gatewayPending, USDC_DECIMALS)} pending`
            : undefined
        }
        dim={inGateway === 0n}
      />
      <Cell
        label="Arc"
        // 18 decimals, not 6 — Arc's native scale. See lib/chains.ts.
        value={fmt(arcBalance, arc.nativeCurrency.decimals)}
        accent
      />
    </dl>
  )
}

function Cell({
  label,
  value,
  note,
  accent,
  dim,
}: {
  label: string
  value: string
  note?: string
  accent?: boolean
  dim?: boolean
}) {
  return (
    <div className="bg-ink/60 px-2 py-2.5">
      <dt className="eyebrow text-[9px] text-muted">{label}</dt>
      <dd
        className={`tnum text-sm ${accent ? 'text-arc' : dim ? 'text-muted' : 'text-white'}`}
      >
        {value}
      </dd>
      {note && <dd className="tnum text-[10px] text-accent">{note}</dd>}
    </div>
  )
}
