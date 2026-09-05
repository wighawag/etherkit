---
'@etherkit/viem-tx-tracker': minor
---

Fix `sendRawTransaction` emitting a different number of events depending on `populateMetadata`.

A raw send parses its full transaction from the signed payload, so both builders emit a fully known transaction (`known: true`) immediately. They then disagreed about what else to do: the standard builder emitted `transaction:broadcasted` **and** `transaction:fetched`, while the auto-populate builder emitted only `transaction:broadcasted`. Two comments in the same file stated the opposite intentions, so one of them was written second and never reconciled.

The effect was silent data loss. `transaction:fetched` is the authoritative event, the one carrying chain-confirmed values, so it is the natural one to persist on. A consumer that did so recorded every transaction except raw ones, and only when `populateMetadata: true` was set, a flag that has nothing to do with raw sends. Nothing threw and nothing was logged: the transaction simply never arrived.

The auto-populate builder now emits `transaction:fetched` too, so the guarantee is uniform: **every tracked transaction reaches `transaction:fetched`**, and a consumer can persist on that one event alone. A parity test now pins the two builders against each other so they cannot drift apart again.

Behaviour change: with `populateMetadata: true`, `sendRawTransaction` and `sendRawTransactionSync` now emit one additional event per send, carrying the same object already delivered to `transaction:broadcasted`. A consumer subscribed to both events that handles them non-idempotently (appending to a list, incrementing a counter) will see that raw send twice where it previously saw it once. Handlers keyed by `hash`, which is the expected shape, are unaffected.

Note on the name: nothing is fetched on the raw path, the values are parsed from the signed payload. `transaction:fetched` describes the mechanism rather than the promise, and that is what produced the divergence: one author reasoned "no fetch happened, so do not emit". What the event actually promises is that the values are final rather than intended, which is true on both paths.
