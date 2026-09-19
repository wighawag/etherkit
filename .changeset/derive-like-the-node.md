---
'@etherkit/burner-wallet': minor
---

**Breaking:** derive accounts at `m/44'/60'/0'/0/{index}`, the path every node uses.

Accounts were derived at `m/44'/60'/{index}'/0/0`, walking BIP-44's *account* level rather than its *address* level, because that is what `eip-1193-accounts-wrapper` does with `numAccounts`. `anvil`, `hardhat node` and MetaMask all enumerate the address level, and BIP-44 agrees with them: the account level separates identities that should not be linked, the address level enumerates one identity's addresses. Ten accounts of one burner are the second thing.

Account 0 is identical under both paths, which is exactly why this survived: with the standard test mnemonic the wallet reported `0xf39F...2266` and looked precisely like the node it was pointed at, and only diverged from account 1 onwards, where it reported `0x8C8d...d650` instead of the well-known `0x7099...79C8`. A developer funding "the second account" from the node's startup banner funded an address the wallet would never report.

`eth_accounts` is now byte-for-byte what `anvil --mnemonic "test test ... junk"` prints, verified against a running node, and the derived private keys are the ones it publishes. Derivation moved into this package (`src/derivation.ts`) rather than being delegated, because the path is a promise made to whoever funds these accounts; the path is exported as `ACCOUNT_DERIVATION_PATH`.

**Migration:** account 0 is unchanged, so most callers are unaffected. If an existing burner holds funds on its second or later account, move them before upgrading, or re-derive the old addresses from the mnemonic at `m/44'/60'/{index}'/0/0`. A persisted account selection that no longer exists is ignored, and the first account is used.

Also fixed: `importMnemonic` now derives before it commits, so a rejected mnemonic changes nothing. It previously stored the new value before validating it, so a typo became the mnemonic `walletManager.get()` reported while the previous one kept signing and stayed in `localStorage`. The two only agreed again after a reload, and a settings screen reading `get()` showed the rejected input as the current wallet.
