---
'@etherkit/burner-wallet': minor
---

**eip-1193 0.7, and eip-1193-accounts-wrapper 0.3.** Depends on `eip-1193` `^0.7.3` (was `^0.6.5`) and `eip-1193-accounts-wrapper` `^0.3.0` (was `^0.2.0`, whose types were still on eip-1193 0.6 and did not declare it). An app no longer needs a `packageExtensions` entry for `eip-1193-accounts-wrapper`.

The public types are eip-1193 0.7's, which is why this is a minor: `BurnerWalletProviderResult.provider`, `announceBurnerWallet`'s and `initBurnerWallet`'s provider are eip-1193 0.7's `EIP1193Provider` (a browser wallet with events), so an app type-checking them has to be on eip-1193 0.7 too. The result fits both an `EIP1193WindowWalletProvider` slot and an `EIP1193CoreProvider` slot, which a type test now pins, and `nodeURL` accepts eip-1193 0.7's node and HTTP node providers as before. No runtime change.
