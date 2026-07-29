'use client'

import { erc20Abi } from '@/lib/abis'
import { arc, base } from '@/lib/chains'
import { USDC_BASE } from '@/lib/gateway'
import type { Address } from 'viem'
import { useBalance, useReadContract } from 'wagmi'
import { useGatewayBalance } from './useGatewayBalance'

const POLL_MS = 20_000

/**
 * Every place the user's USDC can sit during a bridge. One hook so the validation in
 * BridgeCard and the display in Balances can never disagree.
 *
 * Arc deliberately exposes ONE balance, not two. USDC there is both the native gas
 * token (18 decimals) and an ERC-20 at 0x3600…0000 (6 decimals) — but those are the
 * same funds at different scales, verified on four funded accounts where
 * nativeRaw / erc20Raw was exactly 1e12. Showing both would double-count.
 * We read the native balance because it is the gas balance and carries full precision;
 * the ERC-20 view truncates sub-micro-USDC dust.
 */
export function useBalances(address?: Address) {
  const enabled = Boolean(address)

  const baseWallet = useReadContract({
    address: USDC_BASE,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: base.id,
    query: { enabled, refetchInterval: POLL_MS },
  })

  const arcNative = useBalance({
    address,
    chainId: arc.id,
    query: { enabled, refetchInterval: POLL_MS },
  })

  const gateway = useGatewayBalance(address)

  return {
    /** Spendable USDC on Base — what can be deposited. 6 decimals. */
    baseWallet: baseWallet.data as bigint | undefined,
    /** Deposited into GatewayWallet and finalized, ready to bridge. 6 decimals. */
    gatewayAvailable: gateway.data?.available,
    /** Deposited but still finalizing on Circle's side. 6 decimals. */
    gatewayPending: gateway.data?.pending,
    /** Arc balance. 18 decimals — see arc.nativeCurrency in lib/chains.ts. */
    arc: arcNative.data?.value,
    isLoading: baseWallet.isLoading || arcNative.isLoading || gateway.isLoading,
    arcError: arcNative.error,
  }
}
