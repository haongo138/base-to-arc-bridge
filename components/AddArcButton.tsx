'use client'

import { arc } from '@/lib/chains'
import { useState } from 'react'
import { useAccount, useWalletClient } from 'wagmi'

type Status = 'idle' | 'adding' | 'added' | 'error'

/**
 * Adds Arc to the connected wallet via wallet_addEthereumChain.
 *
 * Uses viem's addChain so the params come from the `arc` chain object rather than a
 * hand-written duplicate — chain id, the 18-decimal native currency and the explorer
 * URL stay in one place (lib/chains.ts).
 *
 * Needed because Arc is not in any wallet's built-in network list yet, and the
 * self-mint fallback in useBridge can only switch to a chain the wallet knows.
 */
export function AddArcButton() {
  const { isConnected, chainId } = useAccount()
  const { data: walletClient } = useWalletClient()
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string>()

  // Already on Arc: the wallet demonstrably has it, so the button is noise.
  if (!isConnected || chainId === arc.id) return null

  const add = async () => {
    if (!walletClient) return
    setStatus('adding')
    setError(undefined)
    try {
      await walletClient.addChain({ chain: arc })
      setStatus('added')
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      setStatus('error')
      setError(
        /User rejected|denied/i.test(raw)
          ? 'You dismissed the wallet prompt.'
          : raw.slice(0, 140),
      )
    }
  }

  // The divider lives inside this component so it disappears with it — rendering the
  // border in the parent would leave a stray line whenever this returns null.
  if (status === 'added') {
    return (
      <p className="border-t border-edge pt-3 text-center text-xs text-arc">
        Arc added to your wallet — chain {arc.id}
      </p>
    )
  }

  return (
    <div className="space-y-1 border-t border-edge pt-3 text-center">
      <button
        onClick={add}
        disabled={status === 'adding' || !walletClient}
        className="text-xs text-muted underline decoration-edge underline-offset-4 transition hover:text-white disabled:opacity-50"
      >
        {status === 'adding' ? 'Check your wallet…' : `+ Add Arc (${arc.id}) to your wallet`}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
