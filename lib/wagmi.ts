import { http, createConfig, cookieStorage, createStorage } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { arc, base } from './chains'

export const config = createConfig({
  chains: [base, arc],
  /**
   * Two discovery mechanisms on purpose:
   *  - multiInjectedProviderDiscovery (default on) announces every EIP-6963 wallet,
   *    giving proper names and icons for MetaMask, Rabby, Phantom, Frame, OKX…
   *  - injected() is the catch-all for a wallet that only sets window.ethereum and
   *    never announces.
   *
   * They overlap: with MetaMask installed you get BOTH a generic 'injected' connector
   * and an 'io.metamask' one for the same wallet. ConnectButton resolves that by
   * preferring the announced entries — see the comment there.
   *
   * Cost of this import: `wagmi/connectors` is a barrel, so it drags in
   * @base-org/account -> @coinbase/cdp-sdk and @metamask/sdk, which reference optional
   * modules pnpm does not install. next.config.ts neutralises those.
   */
  connectors: [injected({ shimDisconnect: true })],
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
  transports: {
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL),
    [arc.id]: http(process.env.NEXT_PUBLIC_ARC_RPC_URL),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
