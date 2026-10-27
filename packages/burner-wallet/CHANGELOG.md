# @etherkit/burner-wallet

## 0.2.2

### Patch Changes

- 97fa52e: The burner now says it never prompts. Its EIP-6963 announcement carries `info.autoApproves: true`, the field `@etherplay/wallet-connector` declares on `WalletInfo` and `@etherplay/connect` 0.17 reads with `walletPrompts(info)`. A wallet announced without it is assumed to prompt, so until now an app on connect 0.17 told users to confirm requests in a wallet that never asks, unless it matched the name "Burner Wallet" by hand. Apps can now read `walletPrompts(connection.wallet?.info)` instead.

  `EIP6963ProviderInfo` gains the optional `autoApproves` field, and `announceBurnerWallet` and `initBurnerWallet` take an `autoApproves` option (default `true`) for announcing a provider that does prompt. The field is declared here rather than imported: burner-wallet still has no runtime dependency on connect or wallet-connector.

  A patch rather than a minor: the change is additive (one optional field, one optional option), and under 0.x a minor is the breaking bump, which would strand every app on `^0.2.x`.

- 97fa52e: Document the 0.1.0 derivation path change for people carrying an old burner. The README now has an "Upgrading from 0.0.x" section: the mnemonic in `localStorage` is kept and account 0 keeps its address, but accounts 1 and above change address (from `m/44'/60'/{index}'/0/0` to `m/44'/60'/0'/0/{index}`), so funds on them look lost. It says what to do: move them to account 0 before upgrading, or derive the old accounts afterwards from the same mnemonic with viem's `mnemonicToAccount(mnemonic, {accountIndex})` and move them then. Documentation only, no code change.

## 0.2.1

### Patch Changes

- b6b3801: `@etherkit/burner-wallet` moves to remote-procedure-call `^0.2.0`, whose clients fit eip-1193 0.7 provider types: the node is passed to `createCurriedJSONRPC`, and its `CurriedRPC<CoreMethods>` client to `extendProviderWithAccounts`, without the two casts they needed. No behaviour change. burner-wallet now ships its LICENSE file (MIT, as declared), and `@etherkit/viem-tx-tracker` gets a description and keywords.

## 0.2.0

### Minor Changes

- 600ddbb: **eip-1193 0.7, and eip-1193-accounts-wrapper 0.3.** Depends on `eip-1193` `^0.7.4` (was `^0.6.5`) and `eip-1193-accounts-wrapper` `^0.3.0` (was `^0.2.0`, whose types were still on eip-1193 0.6 and did not declare it). An app no longer needs a `packageExtensions` entry for `eip-1193-accounts-wrapper`.

  The public types are eip-1193 0.7's, which is why this is a minor: `BurnerWalletProviderResult.provider`, `announceBurnerWallet`'s and `initBurnerWallet`'s provider are eip-1193 0.7's `EIP1193Provider` (a browser wallet with events), so an app type-checking them has to be on eip-1193 0.7 too. The result fits both an `EIP1193WindowWalletProvider` slot and an `EIP1193CoreProvider` slot, which a type test now pins, and `nodeURL` still accepts any object with an async `request`, which includes eip-1193 0.7's node and HTTP node providers.

  `EIP1193NodeProvider` (the type of a non-URL `nodeURL`) is renamed `BurnerWalletNodeProvider`, because eip-1193 0.7 exports its own `EIP1193NodeProvider` with a different meaning. The old name stays as a deprecated alias.

  **Chain switching is answered by the wallet.** `wallet_switchEthereumChain` and `wallet_addEthereumChain` used to be forwarded to the node, which answers "method not found" (-32601), so an app asking to switch could not tell a wrong chain from a broken wallet. The burner is bound to one node, so it now answers them itself: `null` when the requested chain is the node's chain (compared as numbers), and otherwise a `ProviderRpcError` with code 4902 for a switch (EIP-3326, "chain not added") or 4200 for an add (it cannot add chains). A missing or non-hex chain id is refused with -32602.

## 0.1.0

### Minor Changes

- 0592846: **Breaking:** derive accounts at `m/44'/60'/0'/0/{index}`, the path every node uses.

  Accounts were derived at `m/44'/60'/{index}'/0/0`, walking BIP-44's _account_ level rather than its _address_ level, because that is what `eip-1193-accounts-wrapper` does with `numAccounts`. `anvil`, `hardhat node` and MetaMask all enumerate the address level, and BIP-44 agrees with them: the account level separates identities that should not be linked, the address level enumerates one identity's addresses. Ten accounts of one burner are the second thing.

  Account 0 is identical under both paths, which is exactly why this survived: with the standard test mnemonic the wallet reported `0xf39F...2266` and looked precisely like the node it was pointed at, and only diverged from account 1 onwards, where it reported `0x8C8d...d650` instead of the well-known `0x7099...79C8`. A developer funding "the second account" from the node's startup banner funded an address the wallet would never report.

  `eth_accounts` is now byte-for-byte what `anvil --mnemonic "test test ... junk"` prints, verified against a running node, and the derived private keys are the ones it publishes. Derivation moved into this package (`src/derivation.ts`) rather than being delegated, because the path is a promise made to whoever funds these accounts; the path is exported as `ACCOUNT_DERIVATION_PATH`.

  **Migration:** account 0 is unchanged, so most callers are unaffected. If an existing burner holds funds on its second or later account, move them before upgrading, or re-derive the old addresses from the mnemonic at `m/44'/60'/{index}'/0/0`. A persisted account selection that no longer exists is ignored, and the first account is used.

  Also fixed: `importMnemonic` now derives before it commits, so a rejected mnemonic changes nothing. It previously stored the new value before validating it, so a typo became the mnemonic `walletManager.get()` reported while the previous one kept signing and stayed in `localStorage`. The two only agreed again after a reload, and a settings screen reading `get()` showed the rejected input as the current wallet.

- 704d838: Point the burner at a chain in the tab, and let it derive one account.

  `nodeURL` now takes `string | EIP1193NodeProvider` rather than `string` alone. The implementation already coped: the RPC client is built with `createCurriedJSONRPC(nodeURL)`, and for a non-string endpoint `remote-procedure-call` calls `endpoint.request({method, params})` per request. Only the type stood in the way, so a consumer pointing the burner at an in-browser chain (webevm) carried a cast. Nothing about the URL path changes.

  `EIP1193NodeProvider` is deliberately just `{request(args): Promise<any>}` rather than `EIP1193Provider` from `eip-1193`. That type is an intersection of per-method overloads plus `on`/`removeListener`, which no node object with a generic `request` satisfies, so naming it would have left the cast exactly where it was. The methods required are the methods used, and a node is asked for no events.

  New `accountCount?: number` option, defaulting to the existing ten. A wallet offering several accounts makes a connecting app show an account picker, which is a second dialog between a player and a game they have already chosen to play; `accountCount: 1` removes it. It bounds derivation rather than filtering it, so account _n_ is the same address whatever the count. Non-integers and values below 1 throw at creation.

  The option exists so nobody hides accounts by wrapping the provider: connectors such as `EthereumWalletProvider` in `@etherplay/wallet-connector-ethereum` call `on` and `removeListener` as well as `request`, so a wrapper forwarding only `request` throws `removeListener is not a function` from inside the connection, as a failed transaction, after the send is signed. That hazard is now stated on the returned provider's type and held by a test.

## 0.0.9

### Patch Changes

- Fix message signing by upgrading eip-1193-accounts-wrapper to 0.2.0.

  `personal_sign` previously built the EIP-191 prefix by hand and then passed the result to viem's `signMessage`, which prefixed it a second time. It also used the character count of the hex string where EIP-191 requires the byte length of the decoded message, and never decoded the hex at all, so the literal `0x...` characters were signed rather than the bytes they encode. Signatures produced by the burner wallet therefore recovered to an unrelated address, and any contract verifying a signed message rejected them. Signatures now recover to the signing account.

  Note that eip-1193-accounts-wrapper 0.2.0 also removes `eth_sign`, which previously applied the `personal_sign` prefix and so was not `eth_sign` at all. It now throws. The burner wallet never called it, but a dapp calling `eth_sign` directly through the provider will now get an error directing it to `personal_sign` or `eth_signTypedData_v4`.

## 0.0.8

### Patch Changes

- update latest accounts wrapper

## 0.0.7

### Patch Changes

- ca76537: fix, also generate mnemonic on accessing eth_accounts, at least for now

## 0.0.6

### Patch Changes

- 1644ccc: still create mnemonic when not present

## 0.0.5

### Patch Changes

- init can provide the impersonated addresses

## 0.0.4

### Patch Changes

- edbe314: support impersonated accounts

## 0.0.3

### Patch Changes

- fix

## 0.0.2

### Patch Changes

- simpler burner-wallet

## 0.0.1

### Patch Changes

- first release
