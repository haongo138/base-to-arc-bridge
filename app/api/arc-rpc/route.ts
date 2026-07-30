import { ARC_RPC_URL } from '@/lib/chains'
import { NextResponse } from 'next/server'

/**
 * Read-only JSON-RPC proxy for Arc.
 *
 * The Arc endpoint authenticates with a key in its path — a wrong key returns 401 — so
 * it cannot live in NEXT_PUBLIC_ARC_RPC_URL, which Next.js inlines into the client
 * bundle. The browser talks to this route instead and the key stays on the server.
 *
 * Deliberately read-only. The app never broadcasts through its own transport: the
 * wallet signs and submits the Arc mint using the user's own network config. Allowing
 * eth_sendRawTransaction here would turn the deployment into an open broadcast relay
 * against someone else's paid endpoint.
 */

export const runtime = 'nodejs'
export const maxDuration = 30

/** Exactly what viem needs for balances, gas estimation and receipt polling. */
const ALLOWED_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_call',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_getCode',
  'eth_getTransactionCount',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getLogs',
  'net_version',
  'web3_clientVersion',
])

/** Per-IP throttle. In-memory, so per-instance on serverless — a speed bump, not a wall. */
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 240 // viem polls; this is generous for a human, tight for a scraper
const hits = new Map<string, number[]>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 5_000) hits.clear()
  return recent.length > RATE_MAX
}

const rpcError = (id: unknown, code: number, message: string, status = 200) =>
  NextResponse.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, { status })

export async function POST(req: Request) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  if (rateLimited(ip)) return rpcError(null, -32005, 'Too many requests', 429)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return rpcError(null, -32700, 'Parse error')
  }

  // viem batches, so accept a single call or an array and vet every method.
  const calls = Array.isArray(body) ? body : [body]
  if (calls.length === 0 || calls.length > 50) {
    return rpcError(null, -32600, 'Invalid batch size')
  }
  for (const c of calls) {
    const method = (c as { method?: unknown })?.method
    if (typeof method !== 'string' || !ALLOWED_METHODS.has(method)) {
      return rpcError(
        (c as { id?: unknown })?.id,
        -32601,
        `Method not supported by this proxy: ${String(method)}`,
      )
    }
  }

  try {
    const upstream = await fetch(ARC_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(25_000),
    })

    const text = await upstream.text()
    if (!upstream.ok) {
      // Never echo the upstream body: a 401 page could leak endpoint details.
      console.error('[arc-rpc] upstream', upstream.status)
      return rpcError(null, -32603, `Arc RPC upstream error (${upstream.status})`, 502)
    }
    return new NextResponse(text, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('[arc-rpc] unreachable:', (error as Error).message.slice(0, 200))
    return rpcError(null, -32603, 'Arc RPC unreachable', 502)
  }
}
