'use client'

import { DOMAIN, gateway, parseGatewayAmount } from '@/lib/gateway'
import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'

/** Circle-side balance on Base: what is spendable now vs still finalizing. */
export function useGatewayBalance(depositor?: Address) {
  return useQuery({
    queryKey: ['gateway-balance', depositor],
    enabled: Boolean(depositor),
    refetchInterval: 20_000,
    queryFn: async () => {
      const { balances } = await gateway.balances(DOMAIN.base, depositor!)
      const row = balances[0]
      return {
        // Decimal strings, not base units — see parseGatewayAmount.
        available: parseGatewayAmount(row?.balance),
        pending: parseGatewayAmount(row?.pendingBatch),
      }
    },
  })
}
