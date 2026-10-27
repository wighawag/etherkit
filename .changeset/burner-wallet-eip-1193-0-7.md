---
'@etherkit/burner-wallet': minor
---

**eip-1193 0.7, and eip-1193-accounts-wrapper 0.3.** Depends on `eip-1193` `^0.7.4` (was `^0.6.5`) and `eip-1193-accounts-wrapper` `^0.3.0` (was `^0.2.0`, whose types were still on eip-1193 0.6 and did not declare it). An app no longer needs a `packageExtensions` entry for `eip-1193-accounts-wrapper`.

The public types are eip-1193 0.7's, which is why this is a minor: `BurnerWalletProviderResult.provider`, `announceBurnerWallet`'s and `initBurnerWallet`'s provider are eip-1193 0.7's `EIP1193Provider` (a browser wallet with events), so an app type-checking them has to be on eip-1193 0.7 too. The result fits both an `EIP1193WindowWalletProvider` slot and an `EIP1193CoreProvider` slot, which a type test now pins, and `nodeURL` still accepts any object with an async `request`, which includes eip-1193 0.7's node and HTTP node providers.

`EIP1193NodeProvider` (the type of a non-URL `nodeURL`) is renamed `BurnerWalletNodeProvider`, because eip-1193 0.7 exports its own `EIP1193NodeProvider` with a different meaning. The old name stays as a deprecated alias.

**Chain switching is answered by the wallet.** `wallet_switchEthereumChain` and `wallet_addEthereumChain` used to be forwarded to the node, which answers "method not found" (-32601), so an app asking to switch could not tell a wrong chain from a broken wallet. The burner is bound to one node, so it now answers them itself: `null` when the requested chain is the node's chain (compared as numbers), and otherwise a `ProviderRpcError` with code 4902 for a switch (EIP-3326, "chain not added") or 4200 for an add (it cannot add chains).
