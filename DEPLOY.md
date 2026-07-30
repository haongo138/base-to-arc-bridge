# Deploying arc-bridge to Vercel

This app moves real USDC. Read the two warnings before making it public.

## 1. Environment variables

Project → Settings → Environment Variables.

| Variable | Scope | Required | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_BASE_RPC_URL` | all | **strongly recommended** | Without it viem uses the public Base endpoint, which rate-limits. Balances will flicker or fail under real traffic. |
| `ARC_RPC_URL` | **Production**, Sensitive | **yes** | Server-only. Browser reaches Arc via `/api/arc-rpc`. Never prefix with `NEXT_PUBLIC_` if the endpoint carries a key. |
| `NEXT_PUBLIC_ARC_RPC_URL` | all | no | Escape hatch for a *keyless* Arc endpoint; bypasses the proxy. |
| `NEXT_PUBLIC_ARC_WALLET_RPC_URL` | all | no | Absolute URL for the "Add Arc" button. Unset → button tells the user to add Arc manually. |
| `NEXT_PUBLIC_ARC_EXPLORER_URL` | all | no | Defaults to the Blockscout instance. |
| `GATEWAY_API_URL` | all | no | Defaults to `https://gateway-api.circle.com`. |
| `ARC_RELAYER_PRIVATE_KEY` | **Production only**, Sensitive | see below | Server-only. Never prefix with `NEXT_PUBLIC_`. |
| `ARC_RELAYER_MIN_BALANCE_WEI` | all | no | Relay refusal floor. Default 0.02 USDC. |

`NEXT_PUBLIC_*` values are inlined into the client bundle at build time — changing one
requires a redeploy, not just a restart.

## 2. ⚠ `/api/mint` spends real money and is unauthenticated

Anyone who finds your deployment can POST to it. Mitigations already in the route:

- **Simulation before broadcast** — a replayed or forged attestation reverts in
  `simulateContract` and costs nothing, instead of burning gas on a failed transaction.
  This closes the cheap drain vector.
- **Balance floor** — refuses to relay below `ARC_RELAYER_MIN_BALANCE_WEI`.
- **Per-IP rate limit** — 5 requests/minute.

**The rate limit is in-memory, so on serverless it is per-instance and only a speed
bump.** Before real traffic, add Vercel Firewall rate limiting (or a KV-backed limiter)
in front of `/api/mint`.

Only fund the relayer with what you are willing to lose — treat it as a hot wallet.
Leaving `ARC_RELAYER_PRIVATE_KEY` unset is a valid, safe configuration: the app falls
back to asking the user's own wallet to mint, which works whenever they hold Arc USDC.

## 3. Function limits

Both API routes set `maxDuration` because they outlive Vercel's plan default (10s Hobby
/ 15s Pro):

- `/api/mint` → **60s** (waits for the Arc receipt; Arc confirms in ~10s)
- `/api/gateway/[...path]` → **30s** (25s upstream timeout)

Hobby caps `maxDuration` at 60s. If you raise the mint wait, you need Pro (300s).

## 4. Deploy

Git integration (recommended — preview per PR, production on `main`):

```bash
vercel link
vercel --prod
```

Or via CI, building before deploying so tests can gate it:

```bash
vercel pull --yes --environment=production --token=$VERCEL_TOKEN
vercel build --prod --token=$VERCEL_TOKEN
vercel deploy --prebuilt --prod --token=$VERCEL_TOKEN
```

CI needs `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (the latter two from
`.vercel/project.json` after `vercel link`).

## 5. Post-deploy smoke test

```bash
# Proxy reaches Circle and Arc is visible (proves the X-ARC header is being injected)
curl -s https://<your-app>/api/gateway/v1/info | grep -o '"chain":"ARC"'

# Relayer status: {"available":true} only if the key is set
curl -s https://<your-app>/api/mint

# Rate limit engages
for i in $(seq 1 7); do curl -s -o /dev/null -w "%{http_code} " -X POST \
  https://<your-app>/api/mint -H 'Content-Type: application/json' -d '{}'; done; echo
# expect: 400 400 400 400 400 429 429   (or 501s if no relayer key)

# Frame protection
curl -sI https://<your-app>/ | grep -i x-frame-options
```

Then bridge a small amount end to end and confirm the mint on the Arc explorer.

## Build notes

- `next/font/google` fetches Space Grotesk / Space Mono / DM Sans **at build time**. A
  build environment without egress to Google Fonts will fail.
- The `@x402/*` workaround exists in both the `webpack` and `turbopack` config blocks.
  If you switch build modes, keep both — `webpack()` is ignored under `--turbopack`.
- `typescript.ignoreBuildErrors` and `eslint.ignoreDuringBuilds` are both `false` on
  purpose: a type error should fail the deploy.

## Known gaps

- **The relayed mint path has never been executed.** Self-mint is verified end to end
  (Base deposit → Arc mint, real funds). The relayer branch is unproven.
- **Bridge progress is not persisted.** A reload mid-bridge loses the step display; the
  app recovers via the "Finish bridging X USDC" prompt, which detects a finalized Gateway
  balance and resumes at signing. Funds are never stranded, but the resume is
  balance-driven, not session-driven.
