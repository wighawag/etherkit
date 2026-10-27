---
'@etherkit/burner-wallet': patch
---

The burner now says it never prompts. Its EIP-6963 announcement carries `info.autoApproves: true`, the field `@etherplay/wallet-connector` declares on `WalletInfo` and `@etherplay/connect` 0.17 reads with `walletPrompts(info)`. A wallet announced without it is assumed to prompt, so until now an app on connect 0.17 told users to confirm requests in a wallet that never asks, unless it matched the name "Burner Wallet" by hand. Apps can now read `walletPrompts(connection.wallet?.info)` instead.

`EIP6963ProviderInfo` gains the optional `autoApproves` field, and `announceBurnerWallet` and `initBurnerWallet` take an `autoApproves` option (default `true`) for announcing a provider that does prompt. The field is declared here rather than imported: burner-wallet still has no runtime dependency on connect or wallet-connector.

A patch rather than a minor: the change is additive (one optional field, one optional option), and under 0.x a minor is the breaking bump, which would strand every app on `^0.2.x`.
