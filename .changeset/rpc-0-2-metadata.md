---
'@etherkit/burner-wallet': patch
'@etherkit/tx-observer': patch
'@etherkit/viem-tx-tracker': patch
---

`@etherkit/burner-wallet` moves to remote-procedure-call `^0.2.0`, whose clients fit eip-1193 0.7 provider types: the node client is built as a `CurriedRPC<CoreMethods>` and passed to `extendProviderWithAccounts` without the two casts it needed. No behaviour change. Every package now ships its LICENSE file (MIT, as declared), and `@etherkit/viem-tx-tracker` gets a description and keywords.
