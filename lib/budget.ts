/**
 * How much of the Gateway balance a bridge should actually spend.
 *
 * The naive choice — spend exactly what the user typed — leaves the unspent fee buffer
 * from every previous bridge stranded, because `maxFee` is a ceiling and the real charge
 * is lower. That accumulates ~0.0065 USDC per bridge forever.
 *
 * The other naive choice — spend the whole Gateway balance — is worse: someone with an
 * abandoned 5 USDC deposit who asks to bridge 1 would have all 6 swept without asking.
 *
 * So: absorb a surplus only when it is genuinely dust, meaning too small to have been
 * bridged on its own. The fee cap is exactly that threshold — below it, `value` would be
 * zero or negative — and it is the same test the UI uses to decide whether to offer a
 * resume.
 */
export function bridgeBudget(input: {
  /** What the user asked to bridge. */
  requested: bigint
  /** Circle-reported finalized balance, the hard ceiling. */
  available: bigint
  /** maxFee including buffer — also the dust threshold. */
  feeCap: bigint
}): bigint {
  const { requested, available, feeCap } = input

  // Never spend more than Circle says is there; /v1/transfer would reject it anyway.
  const wanted = requested > available ? available : requested

  const surplus = available - wanted
  if (surplus > 0n && surplus <= feeCap) return available

  return wanted
}
