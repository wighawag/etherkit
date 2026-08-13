# @etherkit/burner-wallet

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
