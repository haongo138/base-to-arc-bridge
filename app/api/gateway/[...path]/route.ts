import { ARC_HEADER, GATEWAY_API_URL } from '@/lib/gateway'
import { NextResponse } from 'next/server'

/**
 * Proxy to gateway-api.circle.com.
 *
 * Exists for two reasons:
 *  1. The API is not CORS-open to arbitrary origins.
 *  2. X-ARC-PRIVATE-MAINNET-ENABLED is a custom header — without it the API omits
 *     Arc entirely, and it cannot survive a browser preflight.
 */

export const runtime = 'nodejs'

/** The upstream call below allows 25s; Vercel's plan default (10s) would cut it short. */
export const maxDuration = 30

const ALLOWED = new Set(['v1/info', 'v1/balances', 'v1/estimate', 'v1/transfer'])

async function proxy(req: Request, path: string[], method: 'GET' | 'POST') {
  const route = path.join('/')
  if (!ALLOWED.has(route)) {
    return NextResponse.json({ message: `Route not allowed: ${route}` }, { status: 403 })
  }

  const body = method === 'POST' ? await req.text() : undefined

  try {
    const upstream = await fetch(`${GATEWAY_API_URL}/${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...ARC_HEADER },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(25_000),
    })

    const text = await upstream.text()
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return NextResponse.json(
      { message: `Gateway unreachable: ${(error as Error).message}` },
      { status: 502 },
    )
  }
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: Request, { params }: Ctx) {
  return proxy(req, (await params).path, 'GET')
}

export async function POST(req: Request, { params }: Ctx) {
  return proxy(req, (await params).path, 'POST')
}
