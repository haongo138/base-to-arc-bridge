/**
 * Should the "amount exceeds your Base balance" warning be shown?
 *
 * It is a PRE-FLIGHT check: it tells the user to type a smaller number before starting.
 * Once the deposit lands, the comparison is meaningless — the USDC is in GatewayWallet,
 * not the wallet — so the amount will always exceed the (now zero) wallet balance. Left
 * unguarded it renders a red error beside a bridge that is working correctly, which is
 * what happened on a real 131.52 USDC Max bridge.
 *
 * Suppressed when:
 *  - a run is in flight (the user cannot act on it, and the step list is the real status)
 *  - the deposit step has completed in this session
 *  - Gateway already holds AT LEAST this amount, which covers the case where progress
 *    state was lost (page reload, Fast Refresh) but the deposit demonstrably happened
 *
 * That last test is `>= amount`, not `> 0`. Every completed bridge leaves a little unspent
 * fee buffer in Gateway, so `> 0` would silence the warning forever after the first
 * bridge, turning a real over-spend into a silently disabled button.
 */
export function showsOverBalanceWarning(input: {
  amount: bigint | null
  walletBalance: bigint | undefined
  busy: boolean
  depositDone: boolean
  gatewayBalance: bigint
}): boolean {
  const { amount, walletBalance, busy, depositDone, gatewayBalance } = input

  if (amount === null || walletBalance === undefined) return false
  if (amount <= walletBalance) return false

  if (busy || depositDone || gatewayBalance >= amount) return false
  return true
}
