import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hashTypedData } from 'viem'
import {
  BURN_INTENT_DOMAIN,
  BURN_INTENT_TYPES,
  buildBurnIntent,
  buildTransferSpec,
  toBytes32,
  toTypedDataMessage,
  ZERO_BYTES32,
} from './burn-intent'
import { DOMAIN, readQuote, USDC_ARC, USDC_BASE } from './gateway'

const ALICE = '0x1111111111111111111111111111111111111111' as const
const BOB = '0x2222222222222222222222222222222222222222' as const

const spec = (salt: `0x${string}` = `0x${'aa'.repeat(32)}`) =>
  buildTransferSpec({ depositor: ALICE, recipient: BOB, value: 10_000_000n, salt })

const intent = () =>
  buildBurnIntent(spec(), { maxFee: 16_500n, maxBlockHeight: 49_629_542n })

test('addresses become 32-byte left-padded words', () => {
  assert.equal(
    toBytes32(ALICE),
    '0x0000000000000000000000001111111111111111111111111111111111111111',
  )
  assert.equal(toBytes32(ALICE).length, 66)
})

test('routes Base(6) -> Arc(26) with the right tokens', () => {
  const spec = intent().spec
  assert.equal(spec.sourceDomain, DOMAIN.base)
  assert.equal(spec.destinationDomain, DOMAIN.arc)
  assert.equal(spec.sourceToken, toBytes32(USDC_BASE))
  assert.equal(spec.destinationToken, toBytes32(USDC_ARC))
  assert.equal(spec.version, 1)
})

test('recipient is the recipient, not the depositor', () => {
  // Guards the classic bridge bug: minting to the sender on the destination chain.
  const spec = intent().spec
  assert.equal(spec.sourceDepositor, toBytes32(ALICE))
  assert.equal(spec.sourceSigner, toBytes32(ALICE))
  assert.equal(spec.destinationRecipient, toBytes32(BOB))
})

test('destinationCaller is zero so a relayer can pay Arc gas', () => {
  assert.equal(intent().spec.destinationCaller, ZERO_BYTES32)
})

test('salts differ between specs', () => {
  const a = buildTransferSpec({ depositor: ALICE, recipient: BOB, value: 1n })
  const b = buildTransferSpec({ depositor: ALICE, recipient: BOB, value: 1n })
  assert.notEqual(a.salt, b.salt)
})

test('a bare spec is a valid PartialBurnIntent body', () => {
  // /v1/estimate accepts { spec } with no maxFee/maxBlockHeight and fills both in.
  const s = spec()
  assert.equal(Object.hasOwn(s, 'maxFee'), false)
  assert.equal(Object.hasOwn(s, 'maxBlockHeight'), false)
  // Every bytes32 field must be 32 bytes — the API rejects 20-byte addresses.
  for (const key of [
    'sourceContract',
    'destinationContract',
    'sourceToken',
    'destinationToken',
    'sourceDepositor',
    'destinationRecipient',
    'sourceSigner',
    'destinationCaller',
    'salt',
  ] as const) {
    assert.equal(s[key].length, 66, `${key} must be 32-byte hex`)
  }
})

test('buildBurnIntent keeps the local padded spec, not the API echo', () => {
  const s = spec()
  const built = buildBurnIntent(s, { maxFee: 16_500n, maxBlockHeight: 49_629_542n })
  assert.equal(built.maxFee, '16500')
  assert.equal(built.maxBlockHeight, '49629542')
  // Same salt as quoted, and still 32-byte — signing the 20-byte echo would hash wrong.
  assert.equal(built.spec.salt, s.salt)
  assert.equal(built.spec.sourceContract.length, 66)
})

test('typed data hashes deterministically and is domain-separated', () => {
  const msg = toTypedDataMessage(intent())
  const hash = hashTypedData({
    domain: BURN_INTENT_DOMAIN,
    types: BURN_INTENT_TYPES,
    primaryType: 'BurnIntent',
    message: msg as never,
  })
  assert.match(hash, /^0x[0-9a-f]{64}$/)

  // Same input -> same hash.
  assert.equal(
    hash,
    hashTypedData({
      domain: BURN_INTENT_DOMAIN,
      types: BURN_INTENT_TYPES,
      primaryType: 'BurnIntent',
      message: toTypedDataMessage(intent()) as never,
    }),
  )

  // Changing the recipient must change the hash, or the signature would be replayable
  // against a different destination.
  const other = toTypedDataMessage(
    buildBurnIntent(
      buildTransferSpec({
        depositor: ALICE,
        recipient: ALICE, // <- differs
        value: 10_000_000n,
        salt: `0x${'aa'.repeat(32)}`,
      }),
      { maxFee: 16_500n, maxBlockHeight: 49_629_542n },
    ),
  )
  assert.notEqual(
    hash,
    hashTypedData({
      domain: BURN_INTENT_DOMAIN,
      types: BURN_INTENT_TYPES,
      primaryType: 'BurnIntent',
      message: other as never,
    }),
  )
})

test('API-facing intent uses strings, typed-data uses bigints', () => {
  const i = intent()
  assert.equal(typeof i.spec.value, 'string')
  assert.equal(typeof i.maxFee, 'string')
  assert.equal(typeof toTypedDataMessage(i).spec.value, 'bigint')
})

test('readQuote reads the completed intent /v1/estimate returns', () => {
  // Real response shape, captured from the live API.
  const live = [
    {
      burnIntent: {
        maxFee: '11000',
        maxBlockHeight: '49629542',
        // The API renders these as 20-byte hex — proof we must not sign the echo.
        spec: { sourceContract: '0x77777777dcc4d5a8b6e418fd04d8997ef11000ee' },
      },
    },
  ]
  assert.deepEqual(readQuote(live), { maxFee: 11_000n, maxBlockHeight: 49_629_542n })

  // Tolerate a bare object as well as a single-element array.
  assert.deepEqual(readQuote(live[0]), { maxFee: 11_000n, maxBlockHeight: 49_629_542n })
})

test('readQuote refuses to invent numbers when the response is wrong', () => {
  // Silently defaulting maxFee to 0 would sign an intent that can never settle.
  assert.throws(() => readQuote([] as never), /did not return a completed burn intent/)
  assert.throws(() => readQuote({ burnIntent: { maxFee: '1' } } as never), /completed burn intent/)
})
