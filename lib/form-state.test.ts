import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseUnits } from 'viem'
import { showsOverBalanceWarning } from './form-state'

const base = {
  amount: parseUnits('131.521705', 6),
  walletBalance: parseUnits('131.521705', 6),
  busy: false,
  depositDone: false,
  gatewayBalance: 0n,
}

test('warns before starting when the amount really exceeds the wallet', () => {
  assert.equal(
    showsOverBalanceWarning({ ...base, amount: parseUnits('200', 6) }),
    true,
  )
})

test('Max (exactly the balance) is not over', () => {
  assert.equal(showsOverBalanceWarning(base), false)
})

test('silent once the deposit has landed — the reported bug', () => {
  // Real case: Max bridged 131.521705, wallet went to 0, field still held the amount.
  const afterDeposit = {
    ...base,
    walletBalance: 0n,
    depositDone: true,
  }
  assert.equal(showsOverBalanceWarning(afterDeposit), false)
})

test('silent while a run is in flight', () => {
  assert.equal(
    showsOverBalanceWarning({ ...base, walletBalance: 0n, busy: true }),
    false,
  )
})

test('silent when Gateway holds the deposit even if progress state was lost', () => {
  // Fast Refresh resets depositDone to false, but the deposit clearly happened.
  assert.equal(
    showsOverBalanceWarning({
      ...base,
      walletBalance: 0n,
      depositDone: false,
      gatewayBalance: parseUnits('131.528205', 6),
    }),
    false,
  )
})

test('no amount or unknown balance never warns', () => {
  assert.equal(showsOverBalanceWarning({ ...base, amount: null }), false)
  assert.equal(showsOverBalanceWarning({ ...base, walletBalance: undefined }), false)
})

test('a genuinely fresh over-spend still warns', () => {
  assert.equal(
    showsOverBalanceWarning({
      ...base,
      amount: parseUnits('500', 6),
      walletBalance: parseUnits('10', 6),
    }),
    true,
  )
})

test('leftover fee dust must NOT silence a real over-spend', () => {
  // Every completed bridge leaves unspent fee buffer behind. A `> 0` test here would
  // permanently mute the warning after the first bridge.
  assert.equal(
    showsOverBalanceWarning({
      ...base,
      amount: parseUnits('500', 6),
      walletBalance: parseUnits('10', 6),
      gatewayBalance: parseUnits('0.013', 6),
    }),
    true,
  )
})

test('Gateway holding the full amount does silence it', () => {
  assert.equal(
    showsOverBalanceWarning({
      ...base,
      amount: parseUnits('131.521705', 6),
      walletBalance: 0n,
      depositDone: false,
      gatewayBalance: parseUnits('131.528205', 6),
    }),
    false,
  )
})
