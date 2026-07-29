# arc-bridge

Bridge USDC from **Base → Arc mainnet** (chain 5042) through Circle Gateway.
Arc has no official bridge; Gateway already routes to it as domain 26.

See [SPEC.md](./SPEC.md) for the protocol details, what was verified against the live
API, and where the source thread was wrong.

## Setup

```bash
cd arc-bridge
pnpm install
cp .env.example .env.local
pnpm dev
```

Explorer: [arc-mainnet.cloud.blockscout.com](https://arc-mainnet.cloud.blockscout.com) (Blockscout).
An Arc RPC is baked into `lib/chains.ts`; override with `NEXT_PUBLIC_ARC_RPC_URL`.

**Two different decimal counts, both correct.** Arc's `nativeCurrency` is **18**
decimals (native gas is wei), while the USDC token is **6** (`USDC_DECIMALS`). Use
`USDC_DECIMALS` for anything bridged. Confusing them misprices gas by 10^12 — see the
note in `lib/chains.ts`.

```bash
pnpm test        # burn-intent construction + typed-data hashing
pnpm typecheck
pnpm build
```

## Read this before bridging real money

**Arc's gas token is USDC.** The final step, `gatewayMint` on Arc, needs Arc gas — which
a first-time bridger does not have. Set `ARC_RELAYER_PRIVATE_KEY` to a key funded with a
little Arc USDC and the server submits the mint for the user. Without it the app falls
back to asking the user's own wallet, which only works if they already hold Arc USDC.

Relaying is safe: `gatewayMint` pays `destinationRecipient` from the attestation, so the
relayer can spend gas but cannot redirect funds.

**Step 3 is slow.** Circle must index and finalize the Base deposit — roughly 20 minutes.
Until then the USDC sits in `GatewayWallet`, withdrawable. The UI polls and the flow is
resumable from any failed step, so closing the tab loses nothing but progress display.

## Theme

Palette and type are taken from [arc.io](https://www.arc.io/): their hero ramp
(`#000B24 → #0B223E → #143453 → #326796 → #4197A1 → #E2D0AA → white`) and the
Space Grotesk / Space Mono / DM Sans stack, with `{ … }` mono eyebrow labels.

`components/ArcBackdrop.tsx` reproduces the "dawn horizon" as a viewport-fixed layer.
It stops at a warm glow instead of continuing to white — this is a dark card UI, and a
light lower half drops small muted copy to ~2.9:1. Every text run therefore sits on a
panel or a scrim, never straight on the gradient. Verified at 0/29 WCAG AA failures by
sampling real rendered pixels.

## Layout

```
lib/gateway.ts        domains, addresses, proxy client, fee extraction
lib/burn-intent.ts    TransferSpec/BurnIntent + EIP-712 types   ← the part that must be exact
lib/chains.ts         Arc chain definition (USDC as native currency)
lib/abis.ts           only the 5 functions this app calls
hooks/useBridge.ts    6-step state machine, resumable
app/api/gateway/…     server proxy — adds X-ARC-PRIVATE-MAINNET-ENABLED
app/api/mint/         relayed gatewayMint on Arc
components/           BridgeCard, StepList, ConnectButton
```

## Scope

USDC only, one direction, EOA signers. Other Gateway domains, Solana, smart-account
signers, and burn-intent *sets* are deliberately out.
