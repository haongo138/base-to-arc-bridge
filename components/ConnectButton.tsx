'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { pickWallets, walletLabel } from '@/lib/wallets'
import { useAccount, useConnect, useDisconnect } from 'wagmi'

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/**
 * One "Connect wallet" button rather than one button per wallet.
 *
 * Wallet-agnostic by construction: EIP-6963 discovery names and icons Rabby, Phantom,
 * Frame, OKX and the MetaMask/Coinbase extensions, and the generic injected() connector
 * catches anything that only sets window.ethereum. No per-wallet code either way.
 *
 * With exactly one wallet we connect straight to it; with several we show a picker
 * rather than guessing. See lib/wallets.ts for how the two discovery mechanisms are
 * reconciled.
 */
export function ConnectButton({ full = false }: { full?: boolean }) {
  const { address, isConnected } = useAccount()
  const { connectors, connect, isPending, error } = useConnect()
  const { disconnect } = useDisconnect()
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // Resolution rule (and the legacy-wallet branch) lives in lib/wallets.ts so it can be
  // unit-tested — the fallback path is unreachable in a browser that has MetaMask.
  const wallets = useMemo(() => pickWallets(connectors), [connectors])

  // Dismiss the picker on outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (isConnected && address) {
    return (
      <button
        onClick={() => disconnect()}
        title="Disconnect"
        className={`rounded-xl border border-edge bg-panel px-4 py-2 font-mono text-sm text-white transition hover:border-muted ${full ? 'w-full' : ''}`}
      >
        {short(address)}
      </button>
    )
  }

  const start = () => {
    if (wallets.length === 1) connect({ connector: wallets[0] })
    else setOpen((v) => !v)
  }

  const cls = full
    ? 'w-full rounded-xl bg-cta py-3 font-medium text-white transition hover:brightness-110 disabled:opacity-50'
    : 'rounded-xl bg-cta px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50'

  return (
    <div ref={boxRef} className={`relative ${full ? 'w-full' : ''}`}>
      <button
        onClick={start}
        disabled={isPending}
        aria-haspopup={wallets.length > 1 ? 'menu' : undefined}
        aria-expanded={wallets.length > 1 ? open : undefined}
        className={cls}
      >
        {isPending ? 'Check your wallet…' : 'Connect wallet'}
      </button>

      {open && wallets.length > 1 && (
        <div
          role="menu"
          className={`absolute z-20 mt-2 overflow-hidden rounded-xl border border-edge bg-panel shadow-xl ${full ? 'inset-x-0' : 'right-0 w-56'}`}
        >
          {wallets.map((c) => (
            <button
              key={c.uid}
              role="menuitem"
              onClick={() => {
                setOpen(false)
                connect({ connector: c })
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-white transition hover:bg-edge/60"
            >
              {c.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.icon} alt="" className="size-5 rounded" />
              ) : (
                <span className="grid size-5 place-items-center rounded bg-edge text-[10px] text-muted">
                  {walletLabel(c).slice(0, 1)}
                </span>
              )}
              {walletLabel(c)}
            </button>
          ))}
        </div>
      )}

      {/* With injected() in play this means no window.ethereum at all — genuinely no
          wallet, not merely one that failed to announce. */}
      {open && wallets.length === 0 && (
        <div
          className={`absolute z-20 mt-2 rounded-xl border border-edge bg-panel p-3 text-xs leading-relaxed text-muted shadow-xl ${full ? 'inset-x-0' : 'right-0 w-64'}`}
        >
          No wallet found in this browser. Install one — Rabby, MetaMask, Phantom or
          Frame — then reload the page.
        </div>
      )}

      {error && (
        <p className={`mt-1 text-xs text-red-400 ${full ? '' : 'absolute right-0 w-56 text-right'}`}>
          {/User rejected|denied/i.test(error.message)
            ? 'You dismissed the wallet prompt.'
            : error.message.slice(0, 120)}
        </p>
      )}
    </div>
  )
}
