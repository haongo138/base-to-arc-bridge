# Arc Bridge — Base → Arc USDC via Circle Gateway

Arc has no official bridge yet. Circle Gateway already routes Base → Arc in production.
This app drives that route end to end from the browser.

## Verified against the live API (not copied from the thread)

Probed `https://gateway-api.circle.com` on 2026-07-30 with header
`X-ARC-PRIVATE-MAINNET-ENABLED: true`:

- `GET /v1/info` → `{ version, domains: [...] }`. **ARC is present**: `chain: "ARC"`,
  `network: "Mainnet"`, `domain: 26`. Base is `domain: 6`.
- Both domains report the same contracts:
  - `walletContract.address` = `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE`
  - `minterContract.address` = `0x2222222d7164433c4C09B0b0D809a9b52C04C205`
- Each domain also returns `processedHeight` and `burnIntentExpirationHeight`.
  **`burnIntentExpirationHeight` is the value to use for `maxBlockHeight`** — do not
  invent one from the local block number.
- `POST /v1/balances` body `{ token, sources: [{ domain, depositor }] }`
  → `{ token, balances: [{ domain, depositor, balance, pendingBatch }] }`.
  `balance` = spendable now, `pendingBatch` = deposited but not yet finalized.
- `POST /v1/estimate` and `POST /v1/transfer` both take a **JSON array**, not an object.
  (`/v1/transfer` with `[]` → `"At least one signed burn intent or burn intent set is required"`.)
- There is no `/v1/transfer/fees` or `/v1/fees` (both 404).

### `/v1/estimate` completes a partial intent — it is not a fee endpoint

This is the single most important finding, and the easiest thing to get wrong.

`/v1/estimate` takes a **PartialBurnIntent** and returns `[{ burnIntent: {...} }]` — the
same intent with the missing fields filled in. It does not return a fee schedule.

- Omit `maxFee` (or send `0`, or send too little) → Circle returns the **real fee**.
- Send a `maxFee` at or above the real cost → Circle **echoes yours back unchanged**.
- `maxBlockHeight` is filled in and normalized either way, so there is no need to read
  `burnIntentExpirationHeight` from `/v1/info` at all.

Measured 2026-07-30, Base → Arc: the fee is a **flat 11000 base units (0.011 USDC)**,
independent of size — 1, 10, 100 and 1000 USDC all quoted 11000.

**Do not sign the `spec` the response returns.** It renders the `bytes32` address fields
as 20-byte hex (`0x77777777dcc4…ee`, 42 chars) even though the request requires 32-byte
(66 chars). Signing the echo produces the wrong EIP-712 digest. Keep the locally-built
padded spec and take only `maxFee` and `maxBlockHeight` from the quote — that is what
`buildBurnIntent(spec, quote)` in `lib/burn-intent.ts` enforces.

### Corrections to the source thread

| Thread said | Reality |
|---|---|
| "POST /v1/deposits" to monitor | No such endpoint. Deposits are the on-chain `deposit()` tx; you monitor availability via `POST /v1/balances`. |
| "Grab your fee quote + BurnIntent from /v1/estimate" | Half right. You build the spec; `/v1/estimate` completes it. There is no separate fee quote to grab. |

## TransferSpec / BurnIntent

Confirmed empirically — this exact object passed `/v1/estimate` schema validation and
failed only on a deliberately bogus token address.

```
BurnIntent {
  maxBlockHeight: uint256   // returned by /v1/estimate
  maxFee:         uint256   // cap, not a charge; must be >= the fee /v1/estimate returns
  spec:           TransferSpec
}

TransferSpec {
  version              uint32   = 1
  sourceDomain         uint32   = 6   (Base)
  destinationDomain    uint32   = 26  (Arc)
  sourceContract       bytes32  GatewayWallet on Base
  destinationContract  bytes32  GatewayMinter on Arc
  sourceToken          bytes32  USDC on Base  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
  destinationToken     bytes32  USDC on Arc   0x3600000000000000000000000000000000000000
  sourceDepositor      bytes32  who deposited on Base
  destinationRecipient bytes32  who receives on Arc
  sourceSigner         bytes32  who signs the intent (== depositor for EOA flows)
  destinationCaller    bytes32  0x0 = anyone may submit the mint
  value                uint256  USDC, 6 decimals
  salt                 bytes32  random per intent
  hookData             bytes    0x
}
```

All `bytes32` address fields are the 20-byte address **left-padded to 32 bytes**.

EIP-712 domain: `{ name: "GatewayWallet", version: "1" }` — no `chainId`, no
`verifyingContract`, because one signature is verified across two chains.

## Flow

1. `approve(GatewayWallet, amount)` on Base USDC
2. `deposit(USDC, amount)` on Base GatewayWallet
3. Poll `POST /v1/balances` until `balance >= amount` (thread reported ~18 min)
4. `POST /v1/estimate` with `[{ spec }]` → returns `maxFee` + `maxBlockHeight`
5. `signTypedData` the completed BurnIntent (wallet stays on Base — signing is
   chain-agnostic, since the EIP-712 domain has no chainId)
6. `POST /v1/transfer` → `{ attestation, signature }`
7. `gatewayMint(attestation, signature)` on Arc GatewayMinter (~10s)

Verified end to end against the live API with a throwaway key: the signature recovers to
`spec.sourceSigner`, and `/v1/transfer` accepted the intent as valid, failing only on
`"Insufficient balance for depositor …: available 0, required 10.01"` — i.e. it got past
schema *and* signature verification. Note `required` = value + fee.

## The gas trap this app has to solve

**Arc's native gas token is USDC.** A first-time user bridging *into* Arc has zero Arc
balance, so they cannot pay gas for their own `gatewayMint` — the last step of the
bridge is unreachable exactly when it is most needed.

Because `destinationCaller` is `0x0`, *anyone* can submit the mint. So:

- **Default — relayed mint.** `POST /api/mint` submits `gatewayMint` from a server key
  funded with Arc USDC. Enabled when `ARC_RELAYER_PRIVATE_KEY` is set.
- **Fallback — self mint.** If no relayer is configured, the UI switches the wallet to
  Arc and has the user send `gatewayMint` themselves. Requires existing Arc gas.

The attestation is not a bearer instrument for the funds — it mints to
`destinationRecipient` regardless of who submits it — so relaying is safe.

## Network config

| | Base | Arc |
|---|---|---|
| chainId | 8453 | 5042 (`eth_chainId` → `0x13b2`, verified) |
| native decimals | 18 (ETH) | **18** — gas is USDC but in wei units |
| USDC token decimals | 6 | **6** (`decimals()` verified on-chain) |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `0x3600000000000000000000000000000000000000` |
| Gateway domain | 6 | 26 |
| GatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | — |
| GatewayMinter | — | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` |

Arc mainnet explorer: `https://arc-mainnet.cloud.blockscout.com` (Blockscout).

Arc RPC defaults to the endpoint in `lib/chains.ts`; override via
`NEXT_PUBLIC_ARC_RPC_URL`. Verified on that node: `eth_chainId` → `0x13b2` (5042),
reth v1.11.3, `eth_gasPrice` → `0x9502f9000`, GatewayMinter at `0x2222222d…` has
deployed bytecode, and `eth_sendRawTransaction` is served (rejects malformed input with
a decode error rather than method-not-found), so it can broadcast the mint.

## Why the API is proxied through Next.js

`gateway-api.circle.com` is not CORS-open to arbitrary origins, and the
`X-ARC-PRIVATE-MAINNET-ENABLED` header would be a preflight-forbidden custom header
anyway. All Gateway calls go through `app/api/gateway/[...path]/route.ts`, which adds
the header server-side.

## Scope

USDC only, Base → Arc only, EOA signers only. Everything else the Gateway supports
(other domains, Solana, smart-account signers, burn intent *sets*) is deliberately out.
