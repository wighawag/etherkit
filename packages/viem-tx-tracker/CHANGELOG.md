# @etherkit/viem-tx-tracker

## 0.2.1

### Patch Changes

- b6b3801: `@etherkit/burner-wallet` moves to remote-procedure-call `^0.2.0`, whose clients fit eip-1193 0.7 provider types: the node is passed to `createCurriedJSONRPC`, and its `CurriedRPC<CoreMethods>` client to `extendProviderWithAccounts`, without the two casts they needed. No behaviour change. burner-wallet now ships its LICENSE file (MIT, as declared), and `@etherkit/viem-tx-tracker` gets a description and keywords.

## 0.2.0

### Minor Changes

- ed865b2: Fix `sendRawTransaction` emitting a different number of events depending on `populateMetadata`.

  A raw send parses its full transaction from the signed payload, so both builders emit a fully known transaction (`known: true`) immediately. They then disagreed about what else to do: the standard builder emitted `transaction:broadcasted` **and** `transaction:known`, while the auto-populate builder emitted only `transaction:broadcasted`. Two comments in the same file stated the opposite intentions, so one of them was written second and never reconciled.

  The effect was silent data loss. `transaction:known` is the authoritative event, the one carrying chain-confirmed values, so it is the natural one to persist on. A consumer that did so recorded every transaction except raw ones, and only when `populateMetadata: true` was set, a flag that has nothing to do with raw sends. Nothing threw and nothing was logged: the transaction simply never arrived.

  The auto-populate builder now emits `transaction:known` too, so the guarantee is uniform: **every tracked transaction reaches `transaction:known`**, and a consumer can persist on that one event alone. A parity test now pins the two builders against each other so they cannot drift apart again.

  Behaviour change: with `populateMetadata: true`, `sendRawTransaction` and `sendRawTransactionSync` now emit one additional event per send, carrying the same object already delivered to `transaction:broadcasted`. A consumer subscribed to both events that handles them non-idempotently (appending to a list, incrementing a counter) will see that raw send twice where it previously saw it once. Handlers keyed by `hash`, which is the expected shape, are unaffected.

  The event was called `transaction:fetched` until this release; it is renamed to `transaction:known` in the same version, for the reason this bug demonstrates. "Fetched" named the mechanism rather than the promise, and nothing is fetched on the raw path, which is exactly the reasoning that produced the divergence: one author concluded "no fetch happened, so do not emit". What the event promises is that the values are final rather than intended, which is true on both paths.

- 7211eab: Rename the `transaction:fetched` event to `transaction:known`.

  **Breaking.** Replace `on('transaction:fetched', ...)` with `on('transaction:known', ...)`, and the same for `off`. The payload, its type (`KnownTrackedTransaction`) and the timing are unchanged. `transaction:broadcasted` is untouched. There is no compatibility alias: the event key is typed, so a missed call site is a compile error rather than a listener that silently never fires.

  The old name described the mechanism, and the mechanism is not uniform. A normal send reads the transaction back from the chain, so "fetched" was accurate. A raw send parses its values from the signed payload and fetches nothing, so it was not.

  That gap was not academic: it caused a bug fixed in this same release. Reasoning from the name, one of the two builders concluded that a raw send should not emit an event called `fetched`, since no fetch occurred, while the other emitted it "for consistency". The result was a raw send producing a different number of events depending on an unrelated flag, and silent data loss for any consumer that persisted on that event.

  `known` names the promise instead: the values are the final ones rather than the ones you intended. It is true on both paths, and it matches the vocabulary the payload already uses, the `known: true` discriminant and the `KnownTrackedTransaction` type. So `on('transaction:known')` now hands you a transaction whose `known` field is `true`, and the event name, the type name and the discriminant all say the same word.

  What the name still cannot express, and what the docs now state explicitly, is that the two paths differ in reliability: on a normal send the event is best effort and never fires if the chain read fails, whereas on a raw send it always fires immediately.

  Deliberately not chosen: `confirmed`, `settled` and `finalized`. In this domain those mean included in a block, and the event fires while the transaction is still in the mempool, so they would invite a UI that reports an unmined transaction as confirmed. That is a worse failure than the one being fixed. `verified` was rejected too: it implies the tracker checked something, and the obvious thing to assume it checked is that the wallet did not alter the intended values, which it never does.

- 1860be6: Route a broadcast back to the call that issued it, via a new opaque per-call `correlation`.

  Every tracked send (`writeContract`, `sendTransaction`, `sendRawTransaction`, their `*Sync` variants, in both standard and auto-populate mode) now accepts an optional `correlation`, a sibling of `metadata` and `nonce`. It is carried verbatim onto every emitted transaction, so it reaches both `transaction:broadcasted` and `transaction:known`.

  ```ts
  const correlation = crypto.randomUUID();

  tracked.on('transaction:broadcasted', (tx) => {
  	if (tx.correlation) pendingRequests.get(tx.correlation)?.resolve(tx);
  });

  await tracked.sendTransaction({
  	to,
  	value,
  	metadata: {id: 'deposit-1'},
  	correlation,
  });
  ```

  It exists because a consumer cannot otherwise tell which of its own in-flight sends an event belongs to. The emit happens after the wallet round trip (popup, user reads, user confirms), during which the page stays interactive, so a map written just before the send and read in the handler is racy over that whole window. Keying that map on `(from, nonce)` does not fix it either: replacing or cancelling a stuck transaction deliberately creates a second operation at the same nonce, so two concurrent replacements collide and a broadcast is silently attached to the wrong operation.

  There are now three carried fields, answering three different questions:

  | field         | question                                        | supplied              | lifetime               |
  | ------------- | ----------------------------------------------- | --------------------- | ---------------------- |
  | `metadata`    | what the application says the transaction MEANS | per call              | persisted by consumers |
  | `source`      | WHICH SIGNING ROUTE produced it                 | once, at construction | persisted by consumers |
  | `correlation` | which CALLER-SIDE REQUEST this send answers     | per call              | ephemeral plumbing     |

  `correlation` is not intended to be persisted, is not an identity for the transaction (`hash` is), and is meaningless outside the session that issued the send. That is why it is not part of `metadata`: metadata is what consumers store, so plumbing written there would end up in every stored record forever. The tracker never inspects, interprets, validates or defaults it, the same contract as `source`.

  Two design choices worth stating:
  - It is typed `correlation?: string` rather than a generic type parameter. Identity is all a consumer needs in order to route an event, the value is ephemeral, and a 7th type parameter on `TrackedWalletClientType` is a real cost. It is deliberately not `unknown`, which would invite consumers to smuggle structured data into a field the tracker will never interpret.
  - It is threaded to the known-values path, not typed only on the broadcasted shape. It sits on `CommonTrackedFields`, so `transaction:known` (which is rebuilt from the chain read rather than copied from the broadcast) carries it too. Declaring the field without threading it would make the type promise something that is `undefined` at runtime, which is worse than not having the field at all.

  The correlation is destructured out of the arguments before the rest is spread into viem's own call, on every wrapper, so the underlying wallet never receives an unrecognised parameter. That rule is enforced twice: at compile time, by typing the forwarded rest args as `T & {correlation?: never}` so a forgotten destructure fails to build, and at test time, by asserting against a spying wallet client that the parameter object handed to viem contains no `correlation` key.

  Purely additive at the type level: every new field is optional and no existing type changes shape, so code that does not pass a `correlation` keeps compiling untouched. One runtime note: emitted transactions now always carry a `correlation` key, valued `undefined` when none was supplied, which is visible to `Object.keys` and to strict equality checks on the whole object. This matches how `source` already behaves.

## 0.1.0

### Minor Changes

- d3fbe34: Track which signing route produced a transaction, via a new opaque `source`.

  A tracked transaction now carries `source`, a value the tracker records at dispatch and never interprets. It is a sibling of `metadata`, not nested inside it: `metadata` is what the application says a transaction means, `source` is a fact observed when it was sent, like `from` and `nonce`. This lets an application that can send through several routes (a connected wallet, a local signer, a second wallet used only to pay) know which route to reactivate when it needs to replace or cancel a stuck transaction, which an address alone cannot tell it.

  The type is yours: a new `TSource` type parameter, defaulting to `undefined`, on the transaction types, both client interfaces, `TrackedWalletClientType` and `TrackedWalletClientEvents`. The tracker knows nothing about wallets, EIP-6963 or connection libraries.

  ```ts
  type MySource = 'connected-wallet' | 'local-signer' | 'payer-wallet';

  const tracked = createTrackedWalletClient<MyMetadata, MySource>({
  	source: () => currentRoute(), // or a plain value
  }).using(walletClient, publicClient);
  ```

  The source is supplied once, at client construction, never per call: it is a property of the route, not of an individual transaction. A thunk is evaluated at every broadcast, in the same step that stamps `from`, `nonce` and `broadcastTimestampMs`, so a client whose route or account changes over its lifetime always stamps the one that dispatched. Declaring a `TSource` that excludes `undefined` makes the `source` option mandatory, mirroring how `metadata` works.

  With the default `TSource`, existing code is unaffected at the call site: `TSource` was appended last on every type that already had parameters, and both events keep their shape apart from the added field.

  Breaking, at the type level only: `source` is a required property on tracked transactions, as `metadata` already is, so code that builds tracked-transaction object literals (mocks, fixtures, values rehydrated from storage) must add `source: undefined`. Code that only reads transactions is unaffected.

  `CreateTrackedWalletClientOptions` changed from an interface to a type alias, so it can no longer be augmented by declaration merging.

## 0.0.9

### Patch Changes

- new version

## 0.0.8

### Patch Changes

- gasParameters

## 0.0.7

### Patch Changes

- fix

## 0.0.6

### Patch Changes

- support unknown and known tx

## 0.0.5

### Patch Changes

- populateMetadata

## 0.0.4

### Patch Changes

- fix inference

## 0.0.3

### Patch Changes

- 13d2560: normalize types + use broadcastTimestampMs

## 0.0.2

### Patch Changes

- first release
