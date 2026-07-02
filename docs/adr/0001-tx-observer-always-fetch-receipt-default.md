---
status: accepted
---

# tx-observer: `alwaysFetchReceipt` ships opt-in (default `false`), not default-on

## Context

Injected wallets (notably MetaMask on a restartable local/dev node) can keep
returning a stale pending view from `eth_getTransactionByHash` (`blockNumber:
null`) for an already-mined transaction, while `eth_getTransactionReceipt`
still returns the real mined receipt. The observer previously only fetched the
receipt once `getTransactionByHash` reported a block, so against such a provider
a mined tx stayed stuck as `InMemPool` forever. `alwaysFetchReceipt` opts into
fetching the receipt directly in that case (and falling back to the receipt's
`blockHash` for the block lookup), which recovers the correct `Included` status.

## Decision

Ship `alwaysFetchReceipt` as an opt-in config flag defaulting to `false`, rather
than making the receipt-always-fetch behaviour the default or always-on.

## Considered options

- **Default-on / always-on.** More correct for most apps (a direct receipt
  lookup is what block explorers do, and the failure it fixes is severe and
  silent). Rejected for now because it adds one `eth_getTransactionReceipt` per
  tracked, not-yet-included tx per tick; on a busy public RPC with many pending
  intents that is a real, if modest, extra request load that existing consumers
  did not opt into.
- **Opt-in, default `false` (chosen).** Preserves existing behaviour and request
  volume exactly; consumers on lagging/injected-wallet dev chains turn it on
  explicitly.

## Consequences

The flag's only real effect is stale-view recovery: a well-behaved provider that
reports `blockNumber` already triggers the receipt fetch regardless of the flag.
That narrow scope makes default-on low-risk, so this decision should be revisited
(a future major/minor could flip the default) if the stuck-pending failure proves
common enough in the field to outweigh the extra per-tick receipt request.
