---
'@etherkit/tx-observer': minor
---

Make inclusion detection resilient to injected wallets that lag on localhost/dev chains.

- Add an opt-in `alwaysFetchReceipt` option to `createTransactionObserver`. Some
  providers (notably injected wallets like MetaMask on a restartable dev node)
  keep returning a stale pending view from `eth_getTransactionByHash`
  (`blockNumber: null`) for an already-mined transaction, while
  `eth_getTransactionReceipt` still returns the mined receipt. When enabled, the
  observer fetches the receipt directly in that case (and falls back to the
  receipt's `blockHash` for the block lookup), recovering the correct `Included`
  status through the user's own wallet-configured node, with no dedicated RPC.
  Defaults to `false` to preserve existing behaviour.

- Isolate per-intent processing errors in `process()`. A provider error on one
  intent's transaction (e.g. a wallet mishandling a specific request) is now
  logged and retried on the next tick instead of aborting the whole cycle and
  wedging every other intent. Infrastructure-level failures (the initial latest
  and finalized block fetches) still reject `process()`, so a fully unreachable
  provider surfaces as before.

The `alwaysFetchReceipt` option is documented in the README, and the decision to
ship it opt-in (rather than default-on) is recorded in `docs/adr/0001`.
