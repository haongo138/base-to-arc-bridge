'use client'

import { USDC_DECIMALS } from '@/lib/gateway'
import { formatUnits } from 'viem'

/**
 * Fee as a share of the amount being bridged.
 *
 * Worth surfacing because the Gateway fee is FLAT — the same ~0.011 USDC whether you
 * bridge 1 or 1000 — so the percentage is driven entirely by size. 1 USDC costs 1.1%;
 * 0.05 USDC costs 22%. The absolute number looks harmless and hides that.
 */

/** Above this, bridging is poor value; below, it is negligible. */
const NOTICE_PCT = 0.5
const WARN_PCT = 2

const fmt = (v: bigint) =>
  Number(formatUnits(v, USDC_DECIMALS)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })

/** Basis points via bigint, so no precision is lost before the final divide. */
export function feePercent(fee: bigint, amount: bigint): number {
  if (amount <= 0n) return 0
  return Number((fee * 10_000n) / amount) / 100
}

export function FeeBadge({
  fee,
  amount,
  className = '',
}: {
  fee?: bigint
  /** null when the input is empty or unparseable. */
  amount: bigint | null
  className?: string
}) {
  if (fee === undefined) return null

  // No amount yet: the flat fee alone is the honest thing to show.
  if (!amount || amount <= 0n) {
    return (
      <span className={`tnum text-xs text-muted ${className}`}>
        fee {fmt(fee)} USDC
      </span>
    )
  }

  const pct = feePercent(fee, amount)
  const tone =
    pct >= WARN_PCT
      ? 'border-red-500/40 bg-red-500/10 text-red-300'
      : pct >= NOTICE_PCT
        ? 'border-sand/40 bg-sand/10 text-sand'
        : 'border-arc/40 bg-arc/10 text-arc'

  const receives = amount > fee ? amount - fee : 0n

  return (
    <span
      className={`tnum inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${tone} ${className}`}
      title={`Flat Gateway fee of ${fmt(fee)} USDC on ${fmt(amount)} USDC. Recipient gets about ${fmt(receives)} USDC. Re-quoted at signing time.`}
    >
      <span className="font-medium">{pct < 0.01 ? '<0.01' : pct.toFixed(2)}% fee</span>
      <span className="opacity-60">≈{fmt(receives)} received</span>
    </span>
  )
}
