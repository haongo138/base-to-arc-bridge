import { gatewayMinterAbi } from '@/lib/abis'
import { arc, ARC_RPC_URL } from '@/lib/chains'
import { GATEWAY_MINTER } from '@/lib/gateway'
import { NextResponse } from 'next/server'
import { createWalletClient, formatEther, http, isHex, publicActions, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

/**
 * Submit gatewayMint on Arc from a server-funded key.
 *
 * Arc's gas token is USDC, so someone bridging INTO Arc for the first time cannot pay
 * for their own mint. destinationCaller is zero in our intents, so anyone may submit,
 * and the mint always pays destinationRecipient — relaying cannot redirect funds.
 *
 * This endpoint SPENDS REAL MONEY (the relayer's Arc balance) and is unauthenticated,
 * so it is deliberately defensive. See DEPLOY.md before exposing it publicly.
 */

// privateKeyToAccount needs Node, not the edge runtime.
export const runtime = 'nodejs'

/**
 * Vercel kills functions at the plan default (10s Hobby / 15s Pro) long before a
 * receipt arrives. Arc confirms in ~10s but a busy block needs headroom.
 * Hobby allows up to 60s, Pro up to 300s.
 */
export const maxDuration = 60

/** Refuse to relay below this much Arc balance so one caller cannot drain the key. */
const MIN_RELAYER_BALANCE_WEI =
  BigInt(process.env.ARC_RELAYER_MIN_BALANCE_WEI ?? '') || 20_000_000_000_000_000n // 0.02 USDC

/**
 * Per-IP throttle. In-memory, so on serverless it is per-instance and therefore only a
 * speed bump — put Vercel Firewall or a KV-backed limiter in front for real protection.
 * ponytail: adequate for a single-instance deploy; upgrade when traffic justifies it.
 */
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 5
const hits = new Map<string, number[]>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 5_000) hits.clear() // crude bound; this is not a real store
  return recent.length > RATE_MAX
}

export async function GET() {
  return NextResponse.json({ available: Boolean(process.env.ARC_RELAYER_PRIVATE_KEY) })
}

export async function POST(req: Request) {
  const key = process.env.ARC_RELAYER_PRIVATE_KEY
  if (!key) {
    return NextResponse.json(
      { message: 'Relayer not configured. Set ARC_RELAYER_PRIVATE_KEY or mint from your wallet.' },
      { status: 501 },
    )
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  if (rateLimited(ip)) {
    return NextResponse.json({ message: 'Too many mint requests. Try again shortly.' }, { status: 429 })
  }

  let attestation: unknown, signature: unknown
  try {
    ;({ attestation, signature } = await req.json())
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 })
  }

  // Validate at the trust boundary — these go straight into a signed transaction.
  if (!isHex(attestation) || !isHex(signature)) {
    return NextResponse.json(
      { message: 'attestation and signature must be 0x-prefixed hex' },
      { status: 400 },
    )
  }

  try {
    const client = createWalletClient({
      account: privateKeyToAccount(key as Hex),
      chain: arc,
      transport: http(ARC_RPC_URL),
    }).extend(publicActions)

    const balance = await client.getBalance({ address: client.account.address })
    if (balance < MIN_RELAYER_BALANCE_WEI) {
      console.error('[relayer] balance too low:', formatEther(balance))
      return NextResponse.json(
        { message: 'Relayer is out of Arc gas. Mint from your own wallet, or top it up.' },
        { status: 503 },
      )
    }

    /**
     * Simulate first. This is what stops the endpoint being a free gas drain: a replayed
     * or forged attestation reverts here and costs nothing, instead of being broadcast
     * and burning gas on a failed transaction.
     */
    const { request } = await client.simulateContract({
      address: GATEWAY_MINTER,
      abi: gatewayMinterAbi,
      functionName: 'gatewayMint',
      args: [attestation, signature],
      account: client.account,
    })

    const hash = await client.writeContract(request)
    const receipt = await client.waitForTransactionReceipt({
      hash,
      // Stay inside maxDuration so we return a hash rather than being killed mid-wait.
      timeout: (maxDuration - 10) * 1000,
    })

    if (receipt.status !== 'success') {
      return NextResponse.json({ message: 'Mint reverted on Arc', hash }, { status: 500 })
    }
    return NextResponse.json({ hash })
  } catch (error) {
    const message = (error as Error).message ?? 'Mint failed'
    console.error('[relayer] gatewayMint failed:', message.slice(0, 300))
    // Surface the reason — the common ones are actionable (already minted, out of gas).
    return NextResponse.json({ message: message.slice(0, 300) }, { status: 500 })
  }
}
