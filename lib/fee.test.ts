import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseUnits } from 'viem'
import { parseGatewayAmount } from './gateway'

/** Mirrors the arithmetic in useBridge's sign step. */
const FEE_BUFFER_DIVISOR = 2n
const capFor = (quoted: bigint) => quoted + quoted / FEE_BUFFER_DIVISOR
const sendable = (deposit: bigint, quoted: bigint) => deposit - capFor(quoted)

test('/v1/balances amounts are decimal strings, not base units', () => {
  // The live response that broke BigInt(): {"balance":"1.000000"}.
  assert.equal(parseGatewayAmount('1.000000'), 1_000_000n)
  assert.equal(parseGatewayAmount('0'), 0n)
  assert.equal(parseGatewayAmount('1'), 1_000_000n)
  assert.equal(parseGatewayAmount('0.011'), 11_000n)
  assert.equal(parseGatewayAmount(undefined), 0n)
  assert.equal(parseGatewayAmount(''), 0n)
  assert.throws(() => BigInt('1.000000'), /Cannot convert/)
})

test('value + fee must fit the deposit, so value is deposit minus the cap', () => {
  // The live rejection: available 1.000000, required 1.01.
  const deposit = parseUnits('1', 6)
  const quoted = 11_000n // flat Base->Arc fee

  const value = sendable(deposit, quoted)
  assert.equal(capFor(quoted), 16_500n)
  assert.equal(value, 983_500n)

  // The invariant /v1/transfer enforces.
  assert.ok(value + capFor(quoted) <= deposit, 'value + fee must not exceed the deposit')
  assert.equal(value + capFor(quoted), deposit)
})

test('sending the whole deposit is exactly what Circle rejected', () => {
  const deposit = parseUnits('1', 6)
  const quoted = 11_000n
  // The old behaviour: value = deposit, fee on top -> over budget.
  assert.ok(deposit + capFor(quoted) > deposit)
})

test('a deposit too small to cover the fee is refused, not silently zeroed', () => {
  const quoted = 11_000n
  assert.ok(sendable(parseUnits('0.01', 6), quoted) <= 0n)
  assert.ok(sendable(parseUnits('0.0165', 6), quoted) <= 0n)
  // Just above the cap is viable.
  assert.ok(sendable(parseUnits('0.02', 6), quoted) > 0n)
})

test('a 1 USDC bridge nets the recipient 0.9835', () => {
  assert.equal(sendable(parseUnits('1', 6), 11_000n), parseUnits('0.9835', 6))
})
