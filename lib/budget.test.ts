import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseUnits } from 'viem'
import { bridgeBudget } from './budget'

const CAP = 16_500n // 0.011 quote + 50% buffer

test('absorbs leftover fee dust so it stops accumulating', () => {
  // The real case: 131.521705 requested, 0.0065 dust already sitting there.
  const requested = parseUnits('131.521705', 6)
  const available = requested + 6_500n
  assert.equal(bridgeBudget({ requested, available, feeCap: CAP }), available)
})

test('does NOT sweep a balance larger than dust', () => {
  // Abandoned 5 USDC deposit, user asks for 1. Taking all 6 would be an over-send.
  const requested = parseUnits('1', 6)
  const available = parseUnits('6', 6)
  assert.equal(bridgeBudget({ requested, available, feeCap: CAP }), requested)
})

test('surplus exactly at the cap is still dust', () => {
  const requested = parseUnits('10', 6)
  assert.equal(
    bridgeBudget({ requested, available: requested + CAP, feeCap: CAP }),
    requested + CAP,
  )
})

test('surplus one unit above the cap is left alone', () => {
  const requested = parseUnits('10', 6)
  const available = requested + CAP + 1n
  assert.equal(bridgeBudget({ requested, available, feeCap: CAP }), requested)
})

test('no surplus changes nothing', () => {
  const requested = parseUnits('10', 6)
  assert.equal(bridgeBudget({ requested, available: requested, feeCap: CAP }), requested)
})

test('never exceeds what Circle reports available', () => {
  const requested = parseUnits('100', 6)
  const available = parseUnits('40', 6)
  assert.equal(bridgeBudget({ requested, available, feeCap: CAP }), available)
})

test('dust absorption survives repeated bridges — the point of the change', () => {
  // Simulate three bridges; dust must not grow.
  let dust = 0n
  const quote = 11_000n
  const actualFee = 10_000n
  for (let i = 0; i < 3; i++) {
    const requested = parseUnits('10', 6)
    const available = requested + dust
    const budget = bridgeBudget({ requested, available, feeCap: CAP })
    const value = budget - CAP
    dust = available - value - actualFee
  }
  // Each round leaves only the single unspent buffer, never a growing pile.
  assert.equal(dust, CAP - actualFee)
  assert.equal(dust, 6_500n)
})
