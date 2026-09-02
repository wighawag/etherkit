# @etherkit/viem-tx-tracker

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
