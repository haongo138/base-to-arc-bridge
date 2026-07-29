import { parseUnits, type Address } from 'viem'

/** Circle Gateway domain IDs. Verified against GET /v1/info. */
export const DOMAIN = { base: 6, arc: 26 } as const

/** Same addresses on every EVM domain — confirmed from /v1/info. */
export const GATEWAY_WALLET: Address = '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE'
export const GATEWAY_MINTER: Address = '0x2222222d7164433c4C09B0b0D809a9b52C04C205'

export const USDC_BASE: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
export const USDC_ARC: Address = '0x3600000000000000000000000000000000000000'

/**
 * Decimals of the USDC *token* — confirmed by decimals() on both chains. Use this for
 * every bridged amount and Gateway fee.
 *
 * Not to be confused with Arc's nativeCurrency decimals, which is 18 because native
 * gas uses wei units. See the note in lib/chains.ts.
 */
export const USDC_DECIMALS = 6

/** Browser calls hit our proxy, which injects the Arc private-mainnet header. */
export const GATEWAY_PROXY = '/api/gateway'

export const GATEWAY_API_URL =
  process.env.GATEWAY_API_URL || 'https://gateway-api.circle.com'

/**
 * Without this header the API pretends Arc does not exist. Server-side only —
 * a custom header like this would fail CORS preflight from the browser.
 */
export const ARC_HEADER = { 'X-ARC-PRIVATE-MAINNET-ENABLED': 'true' } as const

// ---------------------------------------------------------------------------
// Response types (shapes captured from the live API)
// ---------------------------------------------------------------------------

export type GatewayDomainInfo = {
  chain: string
  network: string
  domain: number
  walletContract: { address: string; supportedTokens: string[] }
  minterContract: { address: string; supportedTokens: string[] }
  processedHeight: string
  /** Use this for BurnIntent.maxBlockHeight. */
  burnIntentExpirationHeight: string
}

export type GatewayInfo = { version: number; domains: GatewayDomainInfo[] }

export type GatewayBalance = {
  domain: number
  depositor: string
  /** Spendable now, in USDC base units. */
  balance: string
  /** Deposited but still finalizing. */
  pendingBatch: string
}

export type GatewayBalances = { token: string; balances: GatewayBalance[] }

/**
 * Parse an amount from /v1/balances.
 *
 * These come back as DECIMAL strings — `"balance":"1.000000"` — not base units, so
 * `BigInt(v)` throws `Cannot convert 1.000000 to a BigInt`.
 *
 * This bit us in production: an empty balance serialises as plain `"0"`, which BigInt
 * accepts, so the bug stayed invisible through every zero-balance test and only appeared
 * the moment real funds were indexed. parseUnits handles "0", "1" and "1.000000" alike.
 */
export function parseGatewayAmount(value: string | undefined | null): bigint {
  const raw = (value ?? '').trim()
  if (!raw) return 0n
  return parseUnits(raw, USDC_DECIMALS)
}

/**
 * POST /v1/estimate does not return a fee schedule — it *completes* a
 * PartialBurnIntent. Omit `maxFee`/`maxBlockHeight` and it returns them filled in.
 * Pass a `maxFee` at or above the real cost and it echoes yours back unchanged.
 *
 * The `spec` it returns renders bytes32 address fields as 20-byte hex, so it is not
 * safe to sign directly — see buildBurnIntent.
 */
export type GatewayEstimate = {
  burnIntent: { maxFee: string; maxBlockHeight: string; spec: Record<string, unknown> }
}

export type GatewayTransferResult = {
  transferId?: string
  attestation: `0x${string}`
  signature: `0x${string}`
} & Record<string, unknown>

// ---------------------------------------------------------------------------
// Client (browser → our proxy)
// ---------------------------------------------------------------------------

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GATEWAY_PROXY}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`Gateway ${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`)
  }
  if (!res.ok) {
    const message =
      (body as { message?: string } | null)?.message ?? `Gateway ${path} failed (${res.status})`
    throw new Error(message)
  }
  return body as T
}

export const gateway = {
  info: () => call<GatewayInfo>('/v1/info'),

  balances: (domain: number, depositor: Address) =>
    call<GatewayBalances>('/v1/balances', {
      method: 'POST',
      body: JSON.stringify({ token: 'USDC', sources: [{ domain, depositor }] }),
    }),

  /** Both /v1/estimate and /v1/transfer take an ARRAY of intents, not an object. */
  estimate: (partials: { spec: unknown }[]) =>
    call<GatewayEstimate[] | GatewayEstimate>('/v1/estimate', {
      method: 'POST',
      body: JSON.stringify(partials),
    }),

  transfer: (signed: { burnIntent: unknown; signature: string }[]) =>
    call<GatewayTransferResult | GatewayTransferResult[]>('/v1/transfer', {
      method: 'POST',
      body: JSON.stringify(signed),
    }),
}

/**
 * Read the two numbers Circle filled in on a completed PartialBurnIntent.
 *
 * Observed 2026-07-30: the Base → Arc fee is a flat 11000 base units (0.011 USDC),
 * independent of transfer size — 1, 10, 100 and 1000 USDC all quoted the same.
 * Nothing here assumes that, since it is not a documented guarantee.
 */
export function readQuote(response: GatewayEstimate[] | GatewayEstimate): {
  maxFee: bigint
  maxBlockHeight: bigint
} {
  const first = Array.isArray(response) ? response[0] : response
  const intent = first?.burnIntent

  if (!intent?.maxFee || !intent?.maxBlockHeight) {
    throw new Error(
      `/v1/estimate did not return a completed burn intent: ${JSON.stringify(response).slice(0, 300)}`,
    )
  }
  return { maxFee: BigInt(intent.maxFee), maxBlockHeight: BigInt(intent.maxBlockHeight) }
}
