'use client'

import { buildTransferSpec } from '@/lib/burn-intent'
import { gateway, readQuote } from '@/lib/gateway'
import { useQuery } from '@tanstack/react-query'
import { parseUnits } from 'viem'
import { useAccount } from 'wagmi'

/**
 * /v1/estimate does not check balances or ownership, so any address yields a quote.
 * This lets the fee be shown before a wallet is connected.
 */
const PROBE_ADDRESS = '0x1111111111111111111111111111111111111111' as const
const PROBE_VALUE = parseUnits('1', 6)

/**
 * The current Base → Arc Gateway fee, quoted live.
 *
 * Quoted once against a nominal 1 USDC rather than per keystroke: the fee was measured
 * flat across 1, 10, 100 and 1000 USDC on 2026-07-30, so it does not vary with size.
 * That makes this advisory only — useBridge re-quotes at signing time, and the value
 * actually signed comes from that fresh quote, never from this cache.
 */
export function useGatewayFee() {
  const { address } = useAccount()
  const who = address ?? PROBE_ADDRESS

  return useQuery({
    queryKey: ['gateway-fee', who],
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
    queryFn: async () => {
      const spec = buildTransferSpec({ depositor: who, recipient: who, value: PROBE_VALUE })
      const quote = readQuote(await gateway.estimate([{ spec }]))
      return quote.maxFee
    },
  })
}
