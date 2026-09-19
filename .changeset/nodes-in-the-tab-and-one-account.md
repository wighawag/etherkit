---
'@etherkit/burner-wallet': minor
---

Point the burner at a chain in the tab, and let it derive one account.

`nodeURL` now takes `string | EIP1193NodeProvider` rather than `string` alone. The implementation already coped: the RPC client is built with `createCurriedJSONRPC(nodeURL)`, and for a non-string endpoint `remote-procedure-call` calls `endpoint.request({method, params})` per request. Only the type stood in the way, so a consumer pointing the burner at an in-browser chain (webevm) carried a cast. Nothing about the URL path changes.

`EIP1193NodeProvider` is deliberately just `{request(args): Promise<any>}` rather than `EIP1193Provider` from `eip-1193`. That type is an intersection of per-method overloads plus `on`/`removeListener`, which no node object with a generic `request` satisfies, so naming it would have left the cast exactly where it was. The methods required are the methods used, and a node is asked for no events.

New `accountCount?: number` option, defaulting to the existing ten. A wallet offering several accounts makes a connecting app show an account picker, which is a second dialog between a player and a game they have already chosen to play; `accountCount: 1` removes it. It bounds derivation rather than filtering it, so account *n* is the same address whatever the count. Non-integers and values below 1 throw at creation.

The option exists so nobody hides accounts by wrapping the provider: connectors such as `EthereumWalletProvider` in `@etherplay/wallet-connector-ethereum` call `on` and `removeListener` as well as `request`, so a wrapper forwarding only `request` throws `removeListener is not a function` from inside the connection, as a failed transaction, after the send is signed. That hazard is now stated on the returned provider's type and held by a test.
