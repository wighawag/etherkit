---
'@etherkit/viem-tx-tracker': minor
---

Rename the `transaction:fetched` event to `transaction:known`.

**Breaking.** Replace `on('transaction:fetched', ...)` with `on('transaction:known', ...)`, and the same for `off`. The payload, its type (`KnownTrackedTransaction`) and the timing are unchanged. `transaction:broadcasted` is untouched. There is no compatibility alias: the event key is typed, so a missed call site is a compile error rather than a listener that silently never fires.

The old name described the mechanism, and the mechanism is not uniform. A normal send reads the transaction back from the chain, so "fetched" was accurate. A raw send parses its values from the signed payload and fetches nothing, so it was not.

That gap was not academic: it caused a bug fixed in this same release. Reasoning from the name, one of the two builders concluded that a raw send should not emit an event called `fetched`, since no fetch occurred, while the other emitted it "for consistency". The result was a raw send producing a different number of events depending on an unrelated flag, and silent data loss for any consumer that persisted on that event.

`known` names the promise instead: the values are the final ones rather than the ones you intended. It is true on both paths, and it matches the vocabulary the payload already uses, the `known: true` discriminant and the `KnownTrackedTransaction` type. So `on('transaction:known')` now hands you a transaction whose `known` field is `true`, and the event name, the type name and the discriminant all say the same word.

What the name still cannot express, and what the docs now state explicitly, is that the two paths differ in reliability: on a normal send the event is best effort and never fires if the chain read fails, whereas on a raw send it always fires immediately.

Deliberately not chosen: `confirmed`, `settled` and `finalized`. In this domain those mean included in a block, and the event fires while the transaction is still in the mempool, so they would invite a UI that reports an unmined transaction as confirmed. That is a worse failure than the one being fixed. `verified` was rejected too: it implies the tracker checked something, and the obvious thing to assume it checked is that the wallet did not alter the intended values, which it never does.
