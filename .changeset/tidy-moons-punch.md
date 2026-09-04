---
'@etherkit/tx-observer': minor
---

BREAKING: one pass over the persisted state types. In 0.x a minor bump is the breaking one, so this is 0.1.x -> 0.2.0 and every stored state needs a read-time upgrade (see below).

**One word per level: `state`, not `state` and `status`.**

- `TransactionIntentStatus` is now `TransactionIntentState`.
- The inner `status` field is now `outcome` on both state types: it answers "did the transaction succeed or revert", which is not what "status" says.
- The `intent:status` event is now `intent:state`. `intent:updated` is unchanged: it still means "anything changed, persist me".

**`attemptIndex` becomes a discriminated `via`.**

An intent can be satisfied by an effect on chain that none of its own transactions produced, so the winning proof is no longer always an index into `transactions[]`:

```ts
via:
	| {kind: 'attempt'; attemptIndex: number}
	| {kind: 'expectedUpdate'; blockNumber: number}
```

The `expectedUpdate` arm carries no `attemptIndex` and forces `outcome: 'Success'`: an observed effect proves something happened, it cannot prove a failure. Its `blockNumber` is the block the effect was seen in, recorded when the win is made and never passed to `add()`: an attempt win recomputes `final` from its receipt on every tick, but nothing can recompute it for an effect that was only sampled, so that arm's finality is `latestBlockNumber - blockNumber >= finality`. Consumers switch on `via.kind`, so future arms are additive.

**`final` is a boolean, and the timestamp has its own name.**

`final?: number` carried two facts at once (past the finality depth, by presence; the inclusion block's timestamp, by value) and a third on the `Dropped` arm. Now:

- `final: boolean` on `Included` and `Dropped`.
- `blockTimestamp?: number` on `Included` only: the inclusion block's timestamp in the chain's own seconds, set as soon as the transaction is included, not only once final, so a UI can show "mined at" before finality.

**Only an observed nonce may declare a transaction dropped.**

A consumer-supplied `nonce` is the INTENDED nonce; a wallet is free to sign a different one. Combined with a hash the node cannot find, that used to produce a confident `Dropped` for a transaction still pending at a higher nonce. The new `nonceObserved?: boolean` is set by the observer when it reads the nonce back from `eth_getTransactionByHash`, and drop detection is gated on it. Without it the transaction stays `NotFound`.

**`chainId` is now enforced.** When a transaction carries a `chainId` that is not the provider's, the intent is skipped and warned about once, instead of being resolved against the wrong chain. The chain id is read once and refreshed in `setProvider()`, which is therefore the call to make when the wallet switches network. A provider that cannot answer `eth_chainId` leaves the check off rather than stranding every tagged intent, and is not asked again until the next `setProvider()`.

**Ticks cost nothing when there is nothing to ask.** Intents from another chain, transactions that are already final, and transactions the observer has given up on are all skipped by the scheduler, so `process()` can return without a single request. A transaction whose hash was never seen on chain and whose supplied nonce is spent in finalized history is one of those: it keeps its honest `NotFound` state and stops being polled, instead of costing RPC on every tick for the life of the stored record. A tick that started before `setProvider()` is discarded rather than written, so answers from one chain never land in a session pointed at another.

**`expectedUpdate` gained its window (types and docs only; detection is still not implemented).** `fromBlock` is filled by `add()` from the block the observer already polls and is emitted so the consumer persists it (refilling it on every reload would push the window past an event that landed while the app was closed). `until` bounds the watch, either `{kind: 'block'}` or `{kind: 'chainTime'}`, both compared exactly against the latest block.

**Other changes:**

- An intent with zero transactions, or one whose transactions have not been looked at yet, now reads as `NotFound`. Previously such an intent got no state at all, and `Dropped` was what the merge logic would have produced for it, which claims the intent failed when nothing observed a failure.
- `intent:state` is now always accompanied by `intent:updated`, so persisting on `intent:updated` can never leave a consumer holding a state the UI was never told about.
- A stored `via: {kind: 'expectedUpdate'}` inclusion survives a tick: the observer cannot re-check an effect it did not see, so it keeps that state unless one of the intent's own attempts succeeds.
- An `expectedUpdate` supplied for an intent that already exists is now adopted instead of silently discarded (an existing one is never replaced, which would move its `fromBlock`).
- Keys that do not apply to an arm are typed `?: never` instead of having to be written as `undefined`.

**Migrating a stored record** (`status` -> `outcome`, `final` -> boolean + `blockTimestamp`, `attemptIndex` -> `via`, missing `nonceObserved` -> `false`): see the "Upgrading from 0.1.x" section of the README, which includes a read-time upgrade function.
