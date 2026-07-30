'use client'

import { erc20Abi, gatewayMinterAbi, gatewayWalletAbi } from '@/lib/abis'
import { bridgeBudget } from '@/lib/budget'
import { arc, base } from '@/lib/chains'
import {
  buildBurnIntent,
  buildTransferSpec,
  BURN_INTENT_DOMAIN,
  BURN_INTENT_TYPES,
  toTypedDataMessage,
} from '@/lib/burn-intent'
import {
  DOMAIN,
  gateway,
  GATEWAY_MINTER,
  GATEWAY_WALLET,
  parseGatewayAmount,
  readQuote,
  USDC_BASE,
  USDC_DECIMALS,
  type GatewayTransferResult,
} from '@/lib/gateway'
import { useCallback, useRef, useState } from 'react'
import { formatUnits, type Address, type Hex } from 'viem'
import {
  useAccount,
  useConfig,
  usePublicClient,
  useSignTypedData,
  useWriteContract,
  type Config,
} from 'wagmi'
import {
  getPublicClient,
  switchChain,
  waitForTransactionReceipt,
  writeContract,
} from 'wagmi/actions'

export type StepId = 'approve' | 'deposit' | 'finalize' | 'sign' | 'attest' | 'mint'

export const STEPS: { id: StepId; label: string; detail: string }[] = [
  { id: 'approve', label: 'Approve USDC', detail: 'Let GatewayWallet pull your USDC on Base' },
  { id: 'deposit', label: 'Deposit on Base', detail: 'deposit(USDC, amount) into GatewayWallet' },
  { id: 'finalize', label: 'Wait for finality', detail: 'Circle indexes the deposit — can take ~20 min' },
  { id: 'sign', label: 'Sign burn intent', detail: 'EIP-712 signature, no gas' },
  { id: 'attest', label: 'Get attestation', detail: 'Circle returns attestation + signature' },
  { id: 'mint', label: 'Mint on Arc', detail: 'gatewayMint on Arc GatewayMinter (~10s)' },
]

export type StepState = 'idle' | 'active' | 'done' | 'error'

/** Everything worth surviving a page refresh mid-bridge. */
type Progress = {
  step: StepId
  states: Record<StepId, StepState>
  /** When the current step went active — drives the elapsed timer in the UI. */
  activeSince?: number
  depositTx?: Hex
  mintTx?: Hex
  attestation?: { attestation: Hex; signature: Hex }
  feeQuoted?: bigint
  /** What the recipient actually gets: the deposit minus the fee cap. */
  willReceive?: bigint
  error?: string
}

const initialStates = (): Record<StepId, StepState> => ({
  approve: 'idle',
  deposit: 'idle',
  finalize: 'idle',
  sign: 'idle',
  attest: 'idle',
  mint: 'idle',
})

const FINALITY_POLL_MS = 15_000
const FINALITY_TIMEOUT_MS = 45 * 60 * 1000
/** Pad the quoted fee by 1/N as headroom (N=2 → +50%). maxFee is a cap, not a charge. */
const FEE_BUFFER_DIVISOR = 2n

export function useBridge() {
  const { address, chainId } = useAccount()
  const config = useConfig()
  const publicClient = usePublicClient({ chainId: base.id })
  const { writeContractAsync } = useWriteContract()
  const { signTypedDataAsync } = useSignTypedData()

  const [progress, setProgress] = useState<Progress>({
    step: 'approve',
    states: initialStates(),
  })
  const [busy, setBusy] = useState(false)
  const cancelled = useRef(false)

  const patch = useCallback((next: Partial<Progress>) => {
    setProgress((p) => ({ ...p, ...next, states: { ...p.states, ...next.states } }))
  }, [])

  const mark = useCallback((step: StepId, state: StepState) => {
    setProgress((p) => ({
      ...p,
      step,
      states: { ...p.states, [step]: state },
      // Restamp only on entering a step, so the timer measures that step, not the run.
      activeSince: state === 'active' ? Date.now() : p.activeSince,
    }))
  }, [])

  const reset = useCallback(() => {
    cancelled.current = false
    setProgress({ step: 'approve', states: initialStates() })
    setBusy(false)
  }, [])

  const cancel = useCallback(() => {
    cancelled.current = true
    setBusy(false)
  }, [])

  /**
   * Run the whole route. Resumable: pass a `from` step to pick up after a refresh
   * or a failure that has since been resolved.
   */
  const run = useCallback(
    async (opts: { amount: bigint; recipient: Address; from?: StepId }) => {
      if (!address) throw new Error('Connect a wallet first')
      if (!publicClient) throw new Error('No Base RPC available')

      const { amount, recipient } = opts
      const order = STEPS.map((s) => s.id)
      const startAt = order.indexOf(opts.from ?? 'approve')
      const should = (id: StepId) => order.indexOf(id) >= startAt

      cancelled.current = false
      setBusy(true)
      patch({ error: undefined })

      // Resuming means the skipped steps already happened (on a previous run, or in an
      // earlier session). Mark them done, otherwise a completed resume reads as
      // "Step 4 of 6" with steps 1-2 still greyed out.
      if (startAt > 0) {
        setProgress((p) => ({
          ...p,
          states: {
            ...p.states,
            ...(Object.fromEntries(order.slice(0, startAt).map((id) => [id, 'done'])) as Record<
              StepId,
              StepState
            >),
          },
        }))
      }

      // Local carry-through so we do not depend on setState having flushed.
      let attestation = progress.attestation

      /**
       * Estimate gas ourselves rather than letting the wallet do it.
       *
       * Left to MetaMask, a Base deposit that genuinely needs ~75k was submitted with a
       * limit of 140,000,000 — Base's block gas limit, i.e. a fallback, not an estimate.
       * Infura caps a single transaction at 25M and rejected it, and viem surfaced that
       * as "the contract function deposit reverted", which is doubly misleading: nothing
       * reverted and the real problem was the gas field.
       *
       * Estimating against our own configured Base RPC gives a concrete limit the wallet
       * will not override, and if a call really would revert this throws the actual
       * reason instead of an opaque RPC error.
       */
      const gasFor = async (params: {
        address: Address
        abi: typeof erc20Abi | typeof gatewayWalletAbi
        functionName: string
        args: readonly unknown[]
      }) => {
        const estimate = await publicClient.estimateContractGas({
          ...params,
          account: address,
        } as never)
        return estimate + estimate / 5n // 20% headroom for state drift between blocks
      }

      try {
        if (chainId !== base.id) await switchChain(config, { chainId: base.id })

        // --- 1. approve -----------------------------------------------------
        if (should('approve')) {
          mark('approve', 'active')
          const allowance = await publicClient.readContract({
            address: USDC_BASE,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [address, GATEWAY_WALLET],
          })
          if (allowance < amount) {
            const approveArgs = {
              address: USDC_BASE,
              abi: erc20Abi,
              functionName: 'approve' as const,
              args: [GATEWAY_WALLET, amount] as const,
            }
            const hash = await writeContractAsync({
              ...approveArgs,
              gas: await gasFor(approveArgs),
              chainId: base.id,
            })
            await waitForTransactionReceipt(config, { hash, chainId: base.id })
          }
          mark('approve', 'done')
        }

        // --- 2. deposit -----------------------------------------------------
        if (should('deposit')) {
          mark('deposit', 'active')
          const depositArgs = {
            address: GATEWAY_WALLET,
            abi: gatewayWalletAbi,
            functionName: 'deposit' as const,
            args: [USDC_BASE, amount] as const,
          }
          const hash = await writeContractAsync({
            ...depositArgs,
            gas: await gasFor(depositArgs),
            chainId: base.id,
          })
          patch({ depositTx: hash })
          const receipt = await waitForTransactionReceipt(config, { hash, chainId: base.id })
          if (receipt.status !== 'success') throw new Error('Deposit reverted on Base')
          mark('deposit', 'done')
        }

        // --- 3. wait for Circle to finalize the deposit ----------------------
        if (should('finalize')) {
          mark('finalize', 'active')
          const deadline = Date.now() + FINALITY_TIMEOUT_MS
          for (;;) {
            if (cancelled.current) return
            const { balances } = await gateway.balances(DOMAIN.base, address)
            // Decimal string, not base units — see parseGatewayAmount.
            const available = parseGatewayAmount(balances[0]?.balance)
            if (available >= amount) break
            if (Date.now() > deadline) {
              throw new Error(
                'Deposit still not finalized after 45 min. Your USDC is safe in GatewayWallet — resume from this step later.',
              )
            }
            await sleep(FINALITY_POLL_MS)
          }
          mark('finalize', 'done')
        }

        // --- 4+5. quote, sign, exchange for an attestation -------------------
        // Guarded on 'attest' rather than 'sign' on purpose: signing and attesting are
        // one unit. A signature is worthless without the attestation it buys, so
        // resuming "from attest" has to re-sign rather than skip step 4 and mint with
        // nothing.
        if (should('attest')) {
          mark('sign', 'active')

          /**
           * Re-read the finalized balance. The finalize loop guaranteed it covers
           * `amount`, but it may hold a little more — the unspent fee buffer from an
           * earlier bridge, since maxFee is a ceiling and the real charge is lower.
           * bridgeBudget decides whether that surplus is dust worth absorbing.
           */
          const { balances: signBalances } = await gateway.balances(DOMAIN.base, address)
          const available = parseGatewayAmount(signBalances[0]?.balance)

          // Quote against the ceiling, not the request: whatever we end up sending is
          // <= available, so for any non-decreasing fee schedule this over-estimates
          // rather than under-estimates. (Measured flat regardless of value.)
          const quoteSpec = buildTransferSpec({
            depositor: address,
            recipient,
            value: available > 0n ? available : amount,
          })
          const quote = readQuote(await gateway.estimate([{ spec: quoteSpec }]))

          // Pad the cap so a fee change between quoting and executing does not void the
          // signed intent. maxFee is a ceiling, not a charge.
          const maxFee = quote.maxFee + quote.maxFee / FEE_BUFFER_DIVISOR

          /**
           * The fee is charged ON TOP of `value`, from the same Gateway balance —
           * /v1/transfer requires value + fee <= available. Sending the whole budget is
           * therefore always rejected:
           *   "Insufficient balance … available 1.000000, required 1.01"
           * So the budget is the ceiling and what we can mint is budget minus the fee cap.
           */
          const budget = bridgeBudget({ requested: amount, available, feeCap: maxFee })
          const sendValue = budget - maxFee
          if (sendValue <= 0n) {
            throw new Error(
              `The Gateway fee (${formatUnits(maxFee, USDC_DECIMALS)} USDC incl. buffer) exceeds the ${formatUnits(budget, USDC_DECIMALS)} USDC available to bridge. Bridge a larger amount.`,
            )
          }

          // Same salt as the quoted spec, but the value that actually fits the budget.
          const spec = buildTransferSpec({
            depositor: address,
            recipient,
            value: sendValue,
            salt: quoteSpec.salt,
          })
          const intent = buildBurnIntent(spec, { maxFee, maxBlockHeight: quote.maxBlockHeight })

          const signature = await signTypedDataAsync({
            domain: BURN_INTENT_DOMAIN,
            types: BURN_INTENT_TYPES,
            primaryType: 'BurnIntent',
            message: toTypedDataMessage(intent) as never,
          })

          patch({ feeQuoted: quote.maxFee, willReceive: sendValue })
          mark('sign', 'done')

          mark('attest', 'active')
          const result = await gateway.transfer([{ burnIntent: intent, signature }])
          attestation = readAttestation(result)
          patch({ attestation })
          mark('attest', 'done')
        }

        // --- 6. mint on Arc --------------------------------------------------
        if (should('mint')) {
          if (!attestation) throw new Error('No attestation to mint — re-run from the signing step')
          mark('mint', 'active')
          const mintTx = await submitMint(attestation, config, address)
          patch({ mintTx })
          mark('mint', 'done')
        }
      } catch (error) {
        const message = friendlyError(error)
        setProgress((p) => ({
          ...p,
          error: message,
          states: { ...p.states, [p.step]: 'error' },
        }))
        throw new Error(message)
      } finally {
        setBusy(false)
      }
    },
    [address, chainId, config, patch, mark, progress.attestation, publicClient, signTypedDataAsync, writeContractAsync],
  )

  return { progress, busy, run, reset, cancel }
}

// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** /v1/transfer may return an object or a single-element array. */
function readAttestation(result: GatewayTransferResult | GatewayTransferResult[]) {
  const first = Array.isArray(result) ? result[0] : result
  const attestation = first?.attestation
  const signature = first?.signature
  if (!attestation || !signature) {
    throw new Error(
      `Gateway accepted the transfer but returned no attestation: ${JSON.stringify(result).slice(0, 300)}`,
    )
  }
  return { attestation, signature }
}

/**
 * Prefer the relayer: Arc charges gas in USDC, so an account bridging in for the first
 * time has no way to pay for its own mint. Fall back to the user's wallet when no
 * relayer is configured — that path needs them to already hold Arc USDC.
 */
async function submitMint(
  attn: { attestation: Hex; signature: Hex },
  config: Config,
  account: Address,
): Promise<Hex> {
  const res = await fetch('/api/mint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(attn),
  })

  if (res.ok) return (await res.json()).hash as Hex

  const { message = 'Relayer failed' } = await res
    .json()
    .catch(() => ({ message: 'Relayer failed' }))

  // Either way we try the user's wallet — self-minting beats stranding the attestation.
  try {
    await switchChain(config, { chainId: arc.id })
  } catch {
    throw new Error(
      `Could not mint on Arc. Relayer: ${message}. Your wallet also could not switch to Arc (chain 5042) — add the network manually, or set ARC_RELAYER_PRIVATE_KEY. Your attestation stays valid; retry the mint step.`,
    )
  }

  const mintArgs = {
    address: GATEWAY_MINTER,
    abi: gatewayMinterAbi,
    functionName: 'gatewayMint' as const,
    args: [attn.attestation, attn.signature] as const,
    chainId: arc.id as typeof arc.id,
  }

  // Same reason as the Base side: do not let the wallet invent a block-sized gas limit.
  let gas: bigint | undefined
  try {
    const arcClient = getPublicClient(config, { chainId: arc.id })
    if (arcClient) {
      const estimate = await arcClient.estimateContractGas({ ...mintArgs, account } as never)
      gas = estimate + estimate / 5n
    }
  } catch {
    // Estimation is best-effort here; fall back to the wallet rather than block the mint.
  }

  const hash = await writeContract(config, { ...mintArgs, ...(gas ? { gas } : {}) })
  const receipt = await waitForTransactionReceipt(config, { hash, chainId: arc.id })
  if (receipt.status !== 'success') throw new Error('gatewayMint reverted on Arc')
  return hash
}

function friendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (/User rejected|denied transaction|rejected the request/i.test(raw)) {
    return 'You rejected the request in your wallet.'
  }
  if (/insufficient funds/i.test(raw)) {
    return 'Insufficient funds for gas. On Arc, gas is paid in USDC.'
  }
  if (/maximum per-tx gas limit|exceeds .*gas limit/i.test(raw)) {
    return 'Your wallet submitted an oversized gas limit and the RPC rejected it. Nothing was spent — retry, or switch the network RPC in your wallet.'
  }
  return raw
}
