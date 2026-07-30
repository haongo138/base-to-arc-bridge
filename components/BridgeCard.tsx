'use client'

import { useBalances } from '@/hooks/useBalances'
import { useGatewayFee } from '@/hooks/useGatewayFee'
import { STEPS, useBridge } from '@/hooks/useBridge'
import { arc, base } from '@/lib/chains'
import { showsOverBalanceWarning } from '@/lib/form-state'
import { USDC_DECIMALS } from '@/lib/gateway'
import { useMemo, useState } from 'react'
import { formatUnits, isAddress, parseUnits, type Address } from 'viem'
import { useAccount } from 'wagmi'
import { AddArcButton } from './AddArcButton'
import { Balances } from './Balances'
import { ConnectButton } from './ConnectButton'
import { FeeBadge } from './FeeBadge'
import { StepList } from './StepList'

const fmt = (v: bigint) => Number(formatUnits(v, USDC_DECIMALS)).toLocaleString(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
})

export function BridgeCard() {
  const { address, isConnected } = useAccount()
  const { progress, busy, run, reset } = useBridge()
  const balances = useBalances(address)
  const gatewayFee = useGatewayFee()
  const [amount, setAmount] = useState('')
  const [recipient, setRecipient] = useState('')

  const walletBalance = balances.baseWallet

  const to = (recipient.trim() || address || '') as string

  const parsed = useMemo(() => {
    if (!amount.trim()) return null
    try {
      const v = parseUnits(amount.trim(), USDC_DECIMALS)
      return v > 0n ? v : null
    } catch {
      return null
    }
  }, [amount])

  const recipientValid = isAddress(to)
  const overBalance = parsed !== null && walletBalance !== undefined && parsed > walletBalance
  const canSubmit = isConnected && parsed !== null && recipientValid && !overBalance && !busy

  const done = progress.states.mint === 'done'
  /** Finalized Gateway balance = an interrupted bridge that can be resumed. */
  const pendingInGateway = balances.gatewayAvailable ?? 0n

  /**
   * A completed bridge leaves the unspent fee buffer behind (maxFee is a cap, the actual
   * charge is lower), so a positive Gateway balance is not automatically resumable.
   * Offering "Finish bridging 0.0065 USDC" when the fee alone is 0.011 is a button that
   * can only fail. Require the balance to clear the fee cap before proposing a resume.
   */
  const feeCap =
    gatewayFee.data !== undefined ? gatewayFee.data + gatewayFee.data / 2n : undefined
  const resumable = pendingInGateway > 0n && feeCap !== undefined && pendingInGateway > feeCap
  const gatewayDust = pendingInGateway > 0n && !resumable

  /** Pre-flight only — see lib/form-state.ts for why this must not render mid-bridge. */
  const overBalanceWarning = showsOverBalanceWarning({
    amount: parsed,
    walletBalance,
    busy,
    depositDone: progress.states.deposit === 'done',
    gatewayBalance: pendingInGateway,
  })
  const failedStep = STEPS.find((s) => progress.states[s.id] === 'error')

  return (
    <div className="w-full max-w-md space-y-4">
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          {/* arc.io wraps eyebrow labels in curly braces, set in Space Mono. */}
          <p className="eyebrow text-[10px] text-sand/80">{'{ USDC · CIRCLE GATEWAY }'}</p>
          <h1 className="font-display text-2xl font-light uppercase leading-none tracking-tight">
            Base <span className="text-sand">→</span> Arc
          </h1>
        </div>
        {/* Only the account chip lives here. While disconnected the primary CTA below is
            the single connect affordance — two identical buttons read as a bug. */}
        {isConnected && <ConnectButton />}
      </header>

      <div className="space-y-4 rounded-2xl border border-edge bg-panel/80 p-5 backdrop-blur">
        {isConnected && (
          <Balances
            baseWallet={balances.baseWallet}
            gatewayAvailable={balances.gatewayAvailable}
            gatewayPending={balances.gatewayPending}
            arcBalance={balances.arc}
          />
        )}

        {/* amount */}
        <label className="block space-y-2">
          <span className="flex items-baseline justify-between gap-2 text-xs text-muted">
            <span className="flex items-baseline gap-2">
              <span>Amount</span>
              {/* Live, because the flat fee means the % is entirely a function of size. */}
              <FeeBadge fee={gatewayFee.data} amount={parsed} />
            </span>
            {walletBalance !== undefined && walletBalance > 0n && (
              <button
                type="button"
                onClick={() => setAmount(formatUnits(walletBalance, USDC_DECIMALS))}
                className="shrink-0 text-accent transition hover:brightness-125"
              >
                Max
              </button>
            )}
          </span>
          <div className="flex items-center gap-2 rounded-xl border border-edge bg-ink px-3 focus-within:border-accent">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              disabled={busy}
              className="tnum w-full bg-transparent py-3 text-xl outline-none placeholder:text-muted disabled:opacity-60"
            />
            <span className="text-sm text-muted">USDC</span>
          </div>
        </label>

        {/* recipient */}
        <label className="block space-y-2">
          <span className="text-xs text-muted">Recipient on Arc</span>
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder={address ?? '0x…'}
            disabled={busy}
            spellCheck={false}
            className="w-full rounded-xl border border-edge bg-ink px-3 py-2.5 font-mono text-sm outline-none placeholder:text-muted focus:border-accent disabled:opacity-60"
          />
          {recipient.trim() && !recipientValid && (
            <span className="text-xs text-red-400">Not a valid address</span>
          )}
        </label>

        {overBalanceWarning && (
          <p className="text-xs text-red-400">Amount exceeds your USDC balance on Base.</p>
        )}

        {/**
         * Funds already sitting in GatewayWallet mean a bridge was interrupted after the
         * deposit — a page reload, a closed tab, a failed signature. Without this the
         * only route forward is entering the amount again and pressing Bridge, which
         * re-runs approve+deposit and deposits a SECOND time. Resuming from `finalize`
         * skips both and just signs, attests and mints what is already there.
         */}
        {isConnected && !busy && !done && resumable && (
          <div className="space-y-2 rounded-xl border border-accent/40 bg-accent/10 p-3">
            <p className="text-xs leading-relaxed text-white">
              <span className="tnum font-medium">{fmt(pendingInGateway)} USDC</span> is
              already deposited in Circle Gateway from an unfinished bridge.
            </p>
            <button
              onClick={() => {
                if (!recipientValid) return
                run({
                  amount: pendingInGateway,
                  recipient: to as Address,
                  from: 'finalize',
                }).catch(() => {})
              }}
              disabled={!recipientValid}
              className="w-full rounded-lg bg-cta py-2 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-50"
            >
              Finish bridging {fmt(pendingInGateway)} USDC to Arc
            </button>
            <p className="text-[10px] leading-relaxed text-muted">
              Resumes at the signing step — no new deposit, no extra Base gas.
            </p>
          </div>
        )}

        {/* Below the fee cap it cannot be bridged on its own, but the user should still
            know where it went rather than wondering if it vanished. */}
        {isConnected && !busy && gatewayDust && (
          <p className="tnum text-[11px] leading-relaxed text-muted">
            {fmt(pendingInGateway)} USDC of unspent fee buffer is left in Gateway — too
            small to bridge alone, and it will be spent by your next bridge.
          </p>
        )}

        {/* Disconnected, the primary action IS connecting — a disabled button labelled
            "Connect wallet" just looked broken. Same component as the header, so there
            is one connect path and one wallet picker. */}
        {isConnected ? (
          <button
            onClick={() => {
              if (!parsed || !recipientValid) return
              run({ amount: parsed, recipient: to as Address }).catch(() => {})
            }}
            disabled={!canSubmit}
            className="w-full rounded-xl bg-cta py-3 font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Bridging…' : 'Bridge to Arc'}
          </button>
        ) : (
          <ConnectButton full />
        )}

        <div className="border-t border-edge pt-3">
          <StepList states={progress.states} activeSince={progress.activeSince} />
        </div>

        {progress.feeQuoted !== undefined && progress.feeQuoted > 0n && (
          <p className="tnum text-xs text-muted">
            Gateway fee {fmt(progress.feeQuoted)} USDC
            {progress.willReceive !== undefined && (
              <>
                {' · recipient gets '}
                <span className="text-arc">{fmt(progress.willReceive)} USDC</span>
              </>
            )}
          </p>
        )}

        {progress.error && (
          <div className="space-y-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3">
            <p className="text-xs leading-relaxed text-red-300">{progress.error}</p>
            {failedStep && parsed && recipientValid && (
              <button
                onClick={() =>
                  run({ amount: parsed, recipient: to as Address, from: failedStep.id }).catch(
                    () => {},
                  )
                }
                disabled={busy}
                className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
              >
                Retry from “{failedStep.label}”
              </button>
            )}
          </div>
        )}

        {(progress.depositTx || progress.mintTx) && (
          <div className="space-y-1 text-xs">
            {progress.depositTx && (
              <Tx label="Base deposit" hash={progress.depositTx} url={base.blockExplorers.default.url} />
            )}
            {progress.mintTx && (
              <Tx label="Arc mint" hash={progress.mintTx} url={arc.blockExplorers.default.url} />
            )}
          </div>
        )}

        {done && (
          <button
            onClick={() => {
              reset()
              setAmount('')
            }}
            className="w-full text-xs text-muted hover:text-white"
          >
            Bridge again
          </button>
        )}

        <AddArcButton />
      </div>

      {/* Scrim, not bare text: this sits outside the card, over the lightest part of the
          dawn gradient, where muted-on-teal would fall to ~2.9:1. */}
      <p className="rounded-xl border border-edge/60 bg-ink/85 p-3 text-[11px] leading-relaxed text-muted backdrop-blur-sm">
        Arc has no official bridge. This routes through Circle Gateway, which already
        supports Arc (domain 26). Step 3 is a finality wait on Circle&apos;s side and can take
        ~20 minutes — your USDC sits in GatewayWallet until then and the bridge can be
        resumed.
      </p>
    </div>
  )
}

function Tx({ label, hash, url }: { label: string; hash: string; url: string }) {
  return (
    <a
      href={`${url}/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      className="flex justify-between gap-3 text-muted transition hover:text-white"
    >
      <span>{label}</span>
      <span className="truncate font-mono">{hash.slice(0, 10)}…</span>
    </a>
  )
}
