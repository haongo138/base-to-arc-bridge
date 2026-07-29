/** Minimal shape of a wagmi connector — kept structural so this stays unit-testable. */
export type WalletLike = { id: string; name: string }

/** wagmi's generic fallback connector always uses this id; announced ones use their rdns. */
export const GENERIC_INJECTED_ID = 'injected'

/**
 * Resolve the wallet list from wagmi's connectors.
 *
 * The config runs EIP-6963 discovery *and* a generic `injected()` fallback, so a single
 * wallet normally appears twice — as `io.metamask` ("MetaMask", with an icon) and as
 * `injected` ("Injected"). Deduping by name cannot merge those, since the labels differ.
 *
 * If anything announced itself, keep only announced wallets: they are better identified,
 * and `window.ethereum` in a multi-wallet browser is ambiguous. Fall back to the generic
 * connector only when discovery found nothing — the legacy wallet it exists to serve.
 */
export function pickWallets<T extends WalletLike>(connectors: readonly T[]): T[] {
  const announced = connectors.filter((c) => c.id !== GENERIC_INJECTED_ID)
  const pool = announced.length > 0 ? announced : connectors

  const seen = new Map<string, T>()
  for (const c of pool) {
    const key = c.name.trim().toLowerCase()
    if (!seen.has(key)) seen.set(key, c)
  }
  return [...seen.values()]
}

/** "Injected" means nothing to a user; announced wallets already have real names. */
export function walletLabel(c: WalletLike): string {
  return c.id === GENERIC_INJECTED_ID ? 'Browser wallet' : c.name
}
