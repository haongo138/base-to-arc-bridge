import { defineChain } from 'viem'
import { base } from 'viem/chains'

/** Verified against the RPC: eth_chainId -> 0x13b2. */
export const ARC_CHAIN_ID = 5042

export const ARC_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ||
  'https://real-pump-soon-trust-me-bro-again.poptyedev.com/'

/**
 * Arc mainnet. Not in viem/chains — Arc has no official bridge or registry entry yet.
 *
 * Gas is paid in USDC, which is why a fresh account cannot submit its own gatewayMint
 * (see app/api/mint/route.ts).
 *
 * ---------------------------------------------------------------------------
 * DECIMALS: 18 here, 6 for the token. Both are correct — do not "fix" either.
 * ---------------------------------------------------------------------------
 * The NATIVE gas balance uses standard 18-decimal wei units, so nativeCurrency is 18.
 * The ERC-20 USDC contract at 0x3600…0000 reports decimals() == 6, which is what
 * USDC_DECIMALS in lib/gateway.ts is for — every bridged amount and Gateway fee.
 *
 * Confirmed two ways: decimals() returns 6 on-chain, and eth_gasPrice is 0x9502f9000
 * (4e10). At 18 decimals a 100k-gas transaction costs 4e15 wei = 0.004 USDC, which is
 * sane; reading that same price as 6 decimals would imply billions of USDC per
 * transaction. Mixing the two would misprice gas by 10^12.
 */
export const arc = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [ARC_RPC_URL] },
  },
  blockExplorers: {
    default: {
      name: 'Arcscan',
      url:
        process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ||
        'https://arc-mainnet.cloud.blockscout.com',
      apiUrl: 'https://arc-mainnet.cloud.blockscout.com/api',
    },
  },
})

export { base }
