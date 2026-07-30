import { defineChain } from 'viem'
import { base } from 'viem/chains'

/** Verified against the RPC: eth_chainId -> 0x13b2. */
export const ARC_CHAIN_ID = 5042

/**
 * Server-side Arc endpoint. NOT prefixed with NEXT_PUBLIC_ on purpose: the provider
 * authenticates with a key in the URL path (a wrong key returns 401), and NEXT_PUBLIC_
 * values are inlined into the client bundle where anyone could read it.
 *
 * Only the proxy route and the relayer touch this directly.
 */
export const ARC_RPC_URL = process.env.ARC_RPC_URL || ''

/** Browsers reach Arc through our own route, which holds the key server-side. */
export const ARC_RPC_PROXY_PATH = '/api/arc-rpc'

/**
 * What the wagmi transport talks to.
 *
 * On the server we can use the credentialed endpoint directly. In the browser a
 * relative path is correct — fetch resolves it against the current origin, and the key
 * never leaves the server.
 *
 * NEXT_PUBLIC_ARC_RPC_URL remains an escape hatch for a keyless endpoint; leave it unset
 * when the endpoint is credentialed.
 */
export const ARC_CLIENT_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ||
  (typeof window === 'undefined' ? ARC_RPC_URL || ARC_RPC_PROXY_PATH : ARC_RPC_PROXY_PATH)

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
    default: { http: [ARC_CLIENT_RPC_URL] },
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
