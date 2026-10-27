---
'@etherkit/tx-observer': minor
---

**eip-1193 0.7, declared as a dependency.** The published types import `eip-1193` but it was listed only as a devDependency, so an app type-checked them against whichever eip-1193 its package manager hoisted, and broke when something else brought 0.7 in. It now depends on `eip-1193` `^0.7.3`. Apps can drop the `packageExtensions` entry they added for it.

The provider slots move to the eip-1193 0.7 model, which is why this is a minor: `createTransactionObserver({provider})` (was `EIP1193ProviderWithoutEvents`) and `observer.setProvider(provider)` (was `EIP1193Provider`) both take an `EIP1193CoreProvider`, since the observer only reads chain state. A browser wallet, a JSON-RPC node and a plain HTTP node provider all fit, where under 0.7 the old types would have rejected a node provider. Code passing a 0.6-typed provider has to move to eip-1193 0.7 too. No runtime change.
