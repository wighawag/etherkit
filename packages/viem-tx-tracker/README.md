# @etherkit/viem-tx-tracker

A thin wrapper around a viem `WalletClient` that records what you sent, so you can track it afterwards.

## Overview

viem gives you a transaction hash. That is rarely enough: to show a meaningful pending state, to resume tracking after a reload, or to replace a stuck transaction, you also need to know what the transaction was for, who sent it, with which nonce, and through which signing route.

This package wraps a `WalletClient` with the same method names (`sendTransaction`, `writeContract`, their `*Sync` variants, `sendRawTransaction`) and emits an event for every broadcast, carrying:

- the facts observed at dispatch: `hash`, `from`, `nonce`, `to`, `value`, `data`, `broadcastTimestampMs`, the intended gas parameters and inferred transaction type
- `metadata`: whatever your application says the transaction means, in your own type
- `source`: an opaque marker of which signing route produced it, in your own type
- `correlation`: an opaque marker of which caller-side request a send answers, supplied per call

It also resolves the nonce for you (`pending` by default) and, once broadcast, fetches the transaction back from the chain and emits a second event with the values the chain actually recorded.

The tracker never interprets `metadata`, `source` or `correlation`. It carries them.

## Installation

```bash
npm install @etherkit/viem-tx-tracker viem
```

`viem` (`^2.46.3`) is a peer dependency.

## Quick start

```typescript
import {createPublicClient, createWalletClient, custom, http, parseEther} from 'viem';
import {mainnet} from 'viem/chains';
import {createTrackedWalletClient} from '@etherkit/viem-tx-tracker';

// What a transaction means, in your own words
type MyMetadata = {id: string; title: string};

const walletClient = createWalletClient({chain: mainnet, transport: custom(window.ethereum)});
const publicClient = createPublicClient({chain: mainnet, transport: http()});

const tracked = createTrackedWalletClient<MyMetadata>().using(walletClient, publicClient);

tracked.on('transaction:broadcasted', (tx) => {
  // Fires immediately. Save this: it is everything you need to resume tracking.
  save(tx.hash, tx);
});

tracked.on('transaction:fetched', (tx) => {
  // Fires once the transaction has been read back from the chain,
  // with the values the chain actually recorded.
  save(tx.hash, tx);
});

const hash = await tracked.sendTransaction({
  to: '0x...',
  value: parseEther('0.1'),
  metadata: {id: 'deposit-1', title: 'Deposit'},
});
```

The client is built in two steps. `createTrackedWalletClient<TMetadata>(options?)` fixes the types and the options, `.using(walletClient, publicClient)` binds the clients. This is what lets `TMetadata` be explicit while the transport, chain and account types stay inferred from your wallet client.

## Metadata

`TMetadata` is yours and it is mandatory to declare. Whether the `metadata` argument is required follows from the type:

```typescript
// metadata is required on every call
createTrackedWalletClient<{id: string}>();

// metadata may be omitted
createTrackedWalletClient<{id: string} | undefined>();
```

### Auto-populated metadata

With `populateMetadata: true`, `writeContract` and `writeContractSync` fill in the call they made:

```typescript
import type {PopulatedMetadata} from '@etherkit/viem-tx-tracker';

const tracked = createTrackedWalletClient({populateMetadata: true}).using(
  walletClient,
  publicClient,
);

await tracked.writeContract({address, abi, functionName: 'transfer', args: [to, amount]});
// metadata: {type: 'functionCall', functionName: 'transfer', args: [to, amount]}
```

`type`, `functionName` and `args` are then owned by the tracker: passing any of them yourself throws. You can still extend the rest of the type, in which case your own fields stay required:

```typescript
type MyMetadata = FunctionCallMetadata & {purpose: string};

const tracked = createTrackedWalletClient<MyMetadata>({populateMetadata: true}).using(
  walletClient,
  publicClient,
);

await tracked.writeContract({address, abi, functionName: 'transfer', args, metadata: {purpose: 'checkout'}});
```

`sendTransaction` and `sendRawTransaction` have no contract call to read, so they still take metadata in full. The default `PopulatedMetadata` type includes an `UnknownTypeMetadata` variant for them.

## Source: which route signed

An application can have several ways to send: the wallet the user is connected with, a local signer whose key it holds, a separate wallet connection used only to pay. When one of those transactions gets stuck, replacing or cancelling it means reactivating the route that signed it and reusing that nonce. `from` is not enough to find that route again: it may be dormant, and a locked wallet will not tell you which addresses it holds.

Declare a `TSource` and the tracker will stamp it on every transaction:

```typescript
type MySource = 'connected-wallet' | 'local-signer' | 'payer-wallet';

const tracked = createTrackedWalletClient<MyMetadata, MySource>({
  source: 'local-signer',
}).using(walletClient, publicClient);

tracked.on('transaction:broadcasted', (tx) => {
  tx.source; // 'local-signer'
});
```

Points worth knowing:

- It is supplied once, at construction, and never per call. The source is a property of the route, not of an individual transaction, and a per-call argument is something a call site can forget or state wrongly.
- It can be a thunk, `() => TSource`, evaluated at every broadcast, in the same step that stamps `from`, `nonce` and `broadcastTimestampMs`. Use this when one client can serve different wallets or accounts over its life: a value captured at construction would be silently wrong in exactly that case.
- Declaring a `TSource` that excludes `undefined` makes the option mandatory, so a route cannot be built without saying what it is. `TSource` must always be written explicitly: it is never inferred from the option value.
- It defaults to `undefined`, in which case `source` is simply `undefined` on every transaction.
- The tracker never inspects it. There is no wallet, EIP-6963 or connection-library knowledge in this package: the union is yours.

## Correlation: which request this send answers

A send is asynchronous in a way that matters: `transaction:broadcasted` fires after the wallet round trip, which includes a popup the user may read for a while, during which the page stays interactive and can issue further sends. So the handler has to work out which of its own in-flight requests the event belongs to.

`(from, nonce)` cannot answer that. Replacing or cancelling a stuck transaction deliberately creates a second operation at the *same* nonce, so two concurrent replacements collide and the handler silently attaches a broadcast to the wrong one.

Pass a `correlation` on the call and read it off the event:

```typescript
const correlation = crypto.randomUUID();

tracked.on('transaction:broadcasted', (tx) => {
  // route this broadcast to the request that issued it, not to a (from, nonce) guess
  if (tx.correlation) pendingRequests.get(tx.correlation)?.resolve(tx);
});

await tracked.sendTransaction({to, value, metadata: {id: 'deposit-1'}, correlation});
```

It is a sibling of `metadata` and `nonce` on every tracked send, never nested inside metadata. Three fields are now carried on a tracked transaction and they answer three different questions:

| Field | Question it answers | Supplied | Lifetime |
|-------|---------------------|----------|----------|
| `metadata` | What the application says the transaction **means** | Per call, in your own type | Persisted by consumers |
| `source` | **Which signing route** produced it, a fact observed at dispatch | Once, at client construction, in your own type | Persisted by consumers |
| `correlation` | Which **caller-side request** this send answers | Per call, as a `string` | Ephemeral plumbing, not persisted |

Points worth knowing:

- It is **not intended to be persisted**. That is the whole reason it is not part of `metadata`: metadata is what consumers store, so plumbing written there ends up in every stored record forever.
- It is **not an identity** for the transaction. `hash` is that.
- It is **meaningless outside the session that issued the send**. A value rehydrated from storage carries no information, because the requests it referred to are gone.
- It is typed `correlation?: string`, deliberately, rather than a generic type parameter: identity is all a consumer needs to route an event, and the value is not `unknown`, which would invite smuggling structured data into a field the tracker will never interpret.
- The tracker never inspects, interprets, validates or defaults it, exactly as with `source`. It is also removed from the arguments before they reach viem, so the wallet never sees an unrecognised field.
- It is optional everywhere. Omit it and `correlation` is simply `undefined` on the emitted transaction.

## Nonces

Every method takes `nonce` as either an exact number or a block tag:

```typescript
await tracked.sendTransaction({to, value, nonce: 42});        // exact
await tracked.sendTransaction({to, value, nonce: 'latest'});  // fetch with this block tag
await tracked.sendTransaction({to, value});                   // fetch with 'pending' (default)
```

The resolved nonce is injected into the request and recorded on the emitted transaction, so a replacement can reuse it.

## Events

| Event | Payload | When |
|-------|---------|------|
| `transaction:broadcasted` | `TrackedTransaction<TMetadata, TSource>` | Immediately after the broadcast succeeds |
| `transaction:fetched` | `KnownTrackedTransaction<TMetadata, TSource>` | Once the transaction has been read back from the chain |

```typescript
const unsubscribe = tracked.on('transaction:broadcasted', listener);
unsubscribe();
// or
tracked.off('transaction:broadcasted', listener);
```

`transaction:fetched` is best effort: if the fetch fails (not in the mempool yet, network trouble) it simply does not fire, and a warning is logged. Treat `transaction:broadcasted` as the event you must handle and `transaction:fetched` as a refinement.

For `sendRawTransaction` the full transaction can be parsed from the signed payload, so `transaction:broadcasted` already carries confirmed values (`known: true`) and no separate fetch is needed.

## The transaction shape

A tracked transaction is discriminated by `known`:

- `known: false` means the values are what was intended and provided. The wallet may still change them, typically gas and occasionally the nonce.
- `known: true` means the values are confirmed, read from the chain or parsed from a signed transaction.

Both share the same field paths, so `tx.hash`, `tx.metadata`, `tx.source`, `tx.gasParameters` are always reachable:

```typescript
type CommonFields = {
  readonly hash: `0x${string}`;
  readonly from: `0x${string}`;
  readonly nonce: number;
  readonly to: `0x${string}` | null;
  readonly value: bigint;
  readonly data: `0x${string}`;
  readonly broadcastTimestampMs: number;
  readonly metadata: TMetadata;
  readonly source: TSource;
  readonly correlation?: string;
};
```

On top of that, a second discriminant, `txType`, carries the gas parameters that belong to that transaction type:

```typescript
if (tx.txType === 'eip1559') {
  tx.gasParameters.maxFeePerGas;
  tx.gasParameters.maxPriorityFeePerGas;
} else if (tx.txType === 'legacy' || tx.txType === 'eip2930') {
  tx.gasParameters.gasPrice;
}
```

For a broadcast transaction (`known: false`) the type is inferred from what you provided: `maxFeePerGas` gives `eip1559`, `gasPrice` with an `accessList` gives `eip2930`, `gasPrice` alone gives `legacy`, and nothing gives `txType: undefined`, meaning the wallet will decide. On a fetched transaction (`known: true`) the type and its gas values are the ones the chain recorded, and every gas field is present.

`from` and `nonce` are re-read from the chain on `transaction:fetched`. `metadata`, `source` and `correlation` are not observable on chain, so they are carried through from dispatch unchanged, on every event that carries a transaction.

## API

### `createTrackedWalletClient<TMetadata, TSource?>(options?)`

Returns a builder with a single method, `.using(walletClient, publicClient)`.

| Option | Type | Description |
|--------|------|-------------|
| `source` | `TSource \| (() => TSource)` | The signing route this client is. Required when `TSource` excludes `undefined`, absent by default |
| `populateMetadata` | `boolean` | Auto-populate `type`, `functionName` and `args` in `writeContract` metadata |
| `clock` | `() => number` | Current time in milliseconds, for `broadcastTimestampMs`. Defaults to `Date.now` |

### Client methods

| Method | Returns |
|--------|---------|
| `writeContract(args)` | `Promise<Hash>` |
| `sendTransaction(args)` | `Promise<Hash>` |
| `sendRawTransaction({serializedTransaction, metadata, correlation})` | `Promise<Hash>` |
| `writeContractSync(args)` | `Promise<TransactionReceipt>` |
| `sendTransactionSync(args)` | `Promise<TransactionReceipt>` |
| `sendRawTransactionSync({serializedTransaction, metadata, correlation})` | `Promise<TransactionReceipt>` |
| `on(event, listener)` | `() => void` (unsubscribe) |
| `off(event, listener)` | `void` |

The arguments are viem's, with `nonce` widened to accept a block tag and two fields added: `metadata` and the optional `correlation`. Both are stripped from the arguments before they are handed to viem. The underlying clients stay reachable as `tracked.walletClient` and `tracked.publicClient`.

The account comes from the call (`account`) or from the wallet client. If neither has one, the call throws.

### Types

`TrackedTransaction`, `KnownTrackedTransaction`, `UnknownTrackedTransaction`, `TrackedWalletClient`, `TrackedWalletClientAutoPopulate`, `TrackedWalletClientEvents`, `PopulatedMetadata`, `FunctionCallMetadata`, `UnknownTypeMetadata`, `NonceOption`, `BlockTag`, `AccessList`, `IntendedGasParameters`, `CreateTrackedWalletClientOptions`, `CorrelationField`.

`TrackedWalletClientType` is a convenience for declaring a client variable without spelling out the whole interface:

```typescript
type MyClient = TrackedWalletClientType<MyMetadata>;
type MyAutoClient = TrackedWalletClientType<PopulatedMetadata, true>;
type MySourcedClient = TrackedWalletClientType<
  MyMetadata,
  false,
  Transport,
  Chain,
  Account,
  MySource
>;
```

`TSource` is the last type parameter on the client types and the second on the transaction types, so existing code that spelled out transport, chain and account keeps compiling untouched.

## License

MIT
