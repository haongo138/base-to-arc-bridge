import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatUnits } from 'viem'
import { arc } from './chains'
import { USDC_DECIMALS } from './gateway'

/**
 * Guards the 10^12 trap: Arc's native balance is 18 decimals while USDC-the-token is 6.
 * Reading Arc at 6 would render 929 USDC as 929,839,835 USDC.
 */

test('Arc native is 18 decimals, USDC token is 6', () => {
  assert.equal(arc.nativeCurrency.decimals, 18)
  assert.equal(arc.nativeCurrency.symbol, 'USDC')
  assert.equal(USDC_DECIMALS, 6)
})

test('native and token views of the same Arc funds agree in value', () => {
  // Observed on-chain: nativeRaw / erc20Raw is exactly 1e12 on funded accounts.
  const nativeRaw = 929_839_835_000_000_000_000n
  const tokenRaw = nativeRaw / 1_000_000_000_000n

  assert.equal(tokenRaw, 929_839_835n)
  assert.equal(
    Number(formatUnits(nativeRaw, arc.nativeCurrency.decimals)).toFixed(6),
    Number(formatUnits(tokenRaw, USDC_DECIMALS)).toFixed(6),
  )
})

test('reading Arc at 6 decimals would inflate the balance by a million-fold', () => {
  const nativeRaw = 929_839_835_000_000_000_000n
  const right = Number(formatUnits(nativeRaw, 18))
  const wrong = Number(formatUnits(nativeRaw, USDC_DECIMALS))

  assert.ok(Math.abs(right - 929.839835) < 1e-6, `expected ~929.84, got ${right}`)
  assert.equal(wrong / right, 1e12)
})

test('a Base amount is never formatted with Arc native decimals', () => {
  // 10 USDC on Base.
  const baseRaw = 10_000_000n
  assert.equal(Number(formatUnits(baseRaw, USDC_DECIMALS)), 10)
  // Same bytes read at 18 would vanish to ~0.
  assert.ok(Number(formatUnits(baseRaw, 18)) < 0.000_001)
})
