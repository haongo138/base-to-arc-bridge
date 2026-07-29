import { pad, toHex, type Address, type Hex } from 'viem'
import {
  DOMAIN,
  GATEWAY_MINTER,
  GATEWAY_WALLET,
  USDC_ARC,
  USDC_BASE,
} from './gateway'

export const ZERO_BYTES32: Hex = `0x${'0'.repeat(64)}`

/** Gateway passes addresses as 32-byte left-padded words so one spec works across VMs. */
export const toBytes32 = (address: Address): Hex => pad(address.toLowerCase() as Hex, { size: 32 })

export type TransferSpec = {
  version: number
  sourceDomain: number
  destinationDomain: number
  sourceContract: Hex
  destinationContract: Hex
  sourceToken: Hex
  destinationToken: Hex
  sourceDepositor: Hex
  destinationRecipient: Hex
  sourceSigner: Hex
  destinationCaller: Hex
  value: string
  salt: Hex
  hookData: Hex
}

export type BurnIntent = {
  maxBlockHeight: string
  maxFee: string
  spec: TransferSpec
}

/**
 * EIP-712 types. Must mirror the Solidity structs exactly — a mismatch produces a
 * signature the contract silently attributes to the wrong signer.
 */
export const BURN_INTENT_TYPES = {
  TransferSpec: [
    { name: 'version', type: 'uint32' },
    { name: 'sourceDomain', type: 'uint32' },
    { name: 'destinationDomain', type: 'uint32' },
    { name: 'sourceContract', type: 'bytes32' },
    { name: 'destinationContract', type: 'bytes32' },
    { name: 'sourceToken', type: 'bytes32' },
    { name: 'destinationToken', type: 'bytes32' },
    { name: 'sourceDepositor', type: 'bytes32' },
    { name: 'destinationRecipient', type: 'bytes32' },
    { name: 'sourceSigner', type: 'bytes32' },
    { name: 'destinationCaller', type: 'bytes32' },
    { name: 'value', type: 'uint256' },
    { name: 'salt', type: 'bytes32' },
    { name: 'hookData', type: 'bytes' },
  ],
  BurnIntent: [
    { name: 'maxBlockHeight', type: 'uint256' },
    { name: 'maxFee', type: 'uint256' },
    { name: 'spec', type: 'TransferSpec' },
  ],
} as const

/**
 * No chainId and no verifyingContract: one signature is checked on the source chain
 * to burn and referenced on the destination chain to mint, so it cannot be bound
 * to either.
 */
export const BURN_INTENT_DOMAIN = { name: 'GatewayWallet', version: '1' } as const

export function randomSalt(): Hex {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toHex(bytes)
}

/**
 * Build the Base → Arc spec. This alone is a valid PartialBurnIntent body for
 * `POST /v1/estimate`, which fills in `maxFee` and `maxBlockHeight` for you.
 */
export function buildTransferSpec(params: {
  depositor: Address
  recipient: Address
  /** USDC base units (6 decimals). */
  value: bigint
  salt?: Hex
}): TransferSpec {
  return {
    version: 1,
    sourceDomain: DOMAIN.base,
    destinationDomain: DOMAIN.arc,
    sourceContract: toBytes32(GATEWAY_WALLET),
    destinationContract: toBytes32(GATEWAY_MINTER),
    sourceToken: toBytes32(USDC_BASE),
    destinationToken: toBytes32(USDC_ARC),
    sourceDepositor: toBytes32(params.depositor),
    destinationRecipient: toBytes32(params.recipient),
    // EOA flow: the depositor is the signer.
    sourceSigner: toBytes32(params.depositor),
    // Zero = anyone may submit the mint. This is what lets the relayer pay Arc gas.
    destinationCaller: ZERO_BYTES32,
    value: params.value.toString(),
    salt: params.salt ?? randomSalt(),
    hookData: '0x',
  }
}

/**
 * Complete a spec into a signable BurnIntent using the numbers `/v1/estimate` returned.
 *
 * Deliberately keeps the locally-built `spec` rather than the one the API echoes back:
 * the response renders the bytes32 address fields as 20-byte hex, which would hash to
 * the wrong EIP-712 digest. Only the two integers are taken from the quote.
 */
export function buildBurnIntent(
  spec: TransferSpec,
  quote: { maxFee: bigint; maxBlockHeight: bigint },
): BurnIntent {
  return {
    maxBlockHeight: quote.maxBlockHeight.toString(),
    maxFee: quote.maxFee.toString(),
    spec,
  }
}

/** signTypedData wants bigints for the uint fields; the API wants strings. */
export function toTypedDataMessage(intent: BurnIntent) {
  return {
    maxBlockHeight: BigInt(intent.maxBlockHeight),
    maxFee: BigInt(intent.maxFee),
    spec: { ...intent.spec, value: BigInt(intent.spec.value) },
  }
}
