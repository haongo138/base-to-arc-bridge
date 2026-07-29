import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseUnits } from 'viem'
import { feePercent } from '../components/FeeBadge'

const FLAT_FEE = 11_000n // 0.011 USDC, measured on Base -> Arc

test('a flat fee means the percentage is driven entirely by size', () => {
  assert.equal(feePercent(FLAT_FEE, parseUnits('1', 6)), 1.1)
  assert.equal(feePercent(FLAT_FEE, parseUnits('10', 6)), 0.11)
  assert.equal(feePercent(FLAT_FEE, parseUnits('100', 6)), 0.01)
  assert.equal(feePercent(FLAT_FEE, parseUnits('1000', 6)), 0)
})

test('small amounts are proportionally brutal — the point of the badge', () => {
  assert.equal(feePercent(FLAT_FEE, parseUnits('0.05', 6)), 22)
  assert.ok(feePercent(FLAT_FEE, parseUnits('0.02', 6)) >= 50)
})

test('crosses the warning thresholds where expected', () => {
  // >=2% warns, >=0.5% notices, below that is negligible.
  assert.ok(feePercent(FLAT_FEE, parseUnits('0.5', 6)) >= 2)
  assert.ok(feePercent(FLAT_FEE, parseUnits('1', 6)) >= 0.5)
  assert.ok(feePercent(FLAT_FEE, parseUnits('10', 6)) < 0.5)
})

test('zero or negative amount cannot divide by zero', () => {
  assert.equal(feePercent(FLAT_FEE, 0n), 0)
  assert.equal(feePercent(FLAT_FEE, -1n), 0)
})

test('percentage uses bigint basis points, so no float drift on large amounts', () => {
  // 1e12 base units = 1,000,000 USDC. Naive Number(fee)/Number(amount) still works here,
  // but the bigint path is what keeps it exact.
  assert.equal(feePercent(FLAT_FEE, parseUnits('1000000', 6)), 0)
  assert.equal(feePercent(parseUnits('1', 6), parseUnits('4', 6)), 25)
})
