import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickWallets, walletLabel } from './wallets'

const w = (id: string, name: string) => ({ id, name })

test('drops the generic duplicate when a wallet announced itself', () => {
  // What a browser with only MetaMask reports: same wallet, two connectors.
  const got = pickWallets([w('injected', 'Injected'), w('io.metamask', 'MetaMask')])
  assert.deepEqual(got.map((c) => c.id), ['io.metamask'])
})

test('legacy wallet that never announces still works', () => {
  // The branch injected() exists for — unreachable in a browser that has MetaMask.
  const got = pickWallets([w('injected', 'Injected')])
  assert.deepEqual(got.map((c) => c.id), ['injected'])
  assert.equal(walletLabel(got[0]), 'Browser wallet')
})

test('several announced wallets are all kept, generic still dropped', () => {
  const got = pickWallets([
    w('injected', 'Injected'),
    w('io.metamask', 'MetaMask'),
    w('io.rabby', 'Rabby'),
    w('app.phantom', 'Phantom'),
  ])
  assert.deepEqual(got.map((c) => c.name), ['MetaMask', 'Rabby', 'Phantom'])
})

test('two connectors announcing the same name collapse to one', () => {
  const got = pickWallets([w('io.metamask', 'MetaMask'), w('io.metamask.flask', 'MetaMask')])
  assert.equal(got.length, 1)
  assert.equal(got[0].id, 'io.metamask')
})

test('name matching ignores case and padding', () => {
  const got = pickWallets([w('a', ' Rabby '), w('b', 'rabby')])
  assert.equal(got.length, 1)
})

test('no wallets at all yields an empty list, not a crash', () => {
  assert.deepEqual(pickWallets([]), [])
})

test('announced wallets keep their own names', () => {
  assert.equal(walletLabel(w('io.rabby', 'Rabby')), 'Rabby')
})
