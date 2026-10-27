---
'@etherkit/burner-wallet': patch
'@etherkit/viem-tx-tracker': patch
---

`@etherkit/burner-wallet` moves to remote-procedure-call `^0.2.0`, whose clients fit eip-1193 0.7 provider types: the node is passed to `createCurriedJSONRPC`, and its `CurriedRPC<CoreMethods>` client to `extendProviderWithAccounts`, without the two casts they needed. No behaviour change. burner-wallet now ships its LICENSE file (MIT, as declared), and `@etherkit/viem-tx-tracker` gets a description and keywords.
