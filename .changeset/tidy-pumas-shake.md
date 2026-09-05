---
'@etherkit/viem-tx-tracker': minor
---

Route a broadcast back to the call that issued it, via a new opaque per-call `correlation`.

Every tracked send (`writeContract`, `sendTransaction`, `sendRawTransaction`, their `*Sync` variants, in both standard and auto-populate mode) now accepts an optional `correlation`, a sibling of `metadata` and `nonce`. It is carried verbatim onto every emitted transaction, so it reaches `transaction:broadcasted` and also `transaction:fetched` wherever that event is emitted.

```ts
const correlation = crypto.randomUUID();

tracked.on('transaction:broadcasted', (tx) => {
	if (tx.correlation) pendingRequests.get(tx.correlation)?.resolve(tx);
});

await tracked.sendTransaction({to, value, metadata: {id: 'deposit-1'}, correlation});
```

It exists because a consumer cannot otherwise tell which of its own in-flight sends an event belongs to. The emit happens after the wallet round trip (popup, user reads, user confirms), during which the page stays interactive, so a map written just before the send and read in the handler is racy over that whole window. Keying that map on `(from, nonce)` does not fix it either: replacing or cancelling a stuck transaction deliberately creates a second operation at the same nonce, so two concurrent replacements collide and a broadcast is silently attached to the wrong operation.

There are now three carried fields, answering three different questions:

| field | question | supplied | lifetime |
| --- | --- | --- | --- |
| `metadata` | what the application says the transaction MEANS | per call | persisted by consumers |
| `source` | WHICH SIGNING ROUTE produced it | once, at construction | persisted by consumers |
| `correlation` | which CALLER-SIDE REQUEST this send answers | per call | ephemeral plumbing |

`correlation` is not intended to be persisted, is not an identity for the transaction (`hash` is), and is meaningless outside the session that issued the send. That is why it is not part of `metadata`: metadata is what consumers store, so plumbing written there would end up in every stored record forever. The tracker never inspects, interprets, validates or defaults it, the same contract as `source`.

Two design choices worth stating:

- It is typed `correlation?: string` rather than a generic type parameter. Identity is all a consumer needs in order to route an event, the value is ephemeral, and a 7th type parameter on `TrackedWalletClientType` is a real cost. It is deliberately not `unknown`, which would invite consumers to smuggle structured data into a field the tracker will never interpret.
- It is threaded to the fetched path, not typed only on the broadcasted shape. It sits on `CommonTrackedFields`, so `transaction:fetched` (which is rebuilt from the chain fetch rather than copied from the broadcast) carries it too. Declaring the field without threading it would make the type promise something that is `undefined` at runtime, which is worse than not having the field at all.

The correlation is destructured out of the arguments before the rest is spread into viem's own call, on every wrapper, so the underlying wallet never receives an unrecognised parameter. That rule is enforced twice: at compile time, by typing the forwarded rest args as `T & {correlation?: never}` so a forgotten destructure fails to build, and at test time, by asserting against a spying wallet client that the parameter object handed to viem contains no `correlation` key.

Purely additive at the type level: every new field is optional and no existing type changes shape, so code that does not pass a `correlation` keeps compiling untouched. One runtime note: emitted transactions now always carry a `correlation` key, valued `undefined` when none was supplied, which is visible to `Object.keys` and to strict equality checks on the whole object. This matches how `source` already behaves.
