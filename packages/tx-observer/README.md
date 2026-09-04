# @etherkit/tx-observer

A TypeScript library for monitoring Ethereum transaction intents containing multiple transactions, with automatic state merging and finality tracking.

## Overview

The Transaction Processor tracks **intents** - logical groupings of transactions that belong together. This is useful when:

- **Gas price bumping**: Multiple transactions with the same nonce but different gas prices
- **Sequential retries**: Transactions with different nonces for the same logical action
- **Multi-step intents**: Related transactions that form a single user action

The processor monitors all transactions in an intent and computes a merged state, emitting events when the intent state changes.

## Installation

```bash
npm install @etherkit/tx-observer
```

## Upgrading from 0.1.x

0.2.0 is a breaking release of the two persisted state shapes. If you store `TransactionIntent` (or the states inside it) and hand it back to `add()`, upgrade each stored record when you read it:

| 0.1.x | 0.2.0 |
|-------|-------|
| `status: 'Success' \| 'Failure'` | `outcome: 'Success' \| 'Failure'` |
| `final: number \| undefined` | `final: boolean`, plus `blockTimestamp?: number` on `Included` |
| `attemptIndex: number` | `via: {kind: 'attempt', attemptIndex: number}` |
| (absent) | `nonceObserved?: boolean`, treat a missing value as `false` |
| event `'intent:status'` | event `'intent:state'` |
| type `TransactionIntentStatus` | type `TransactionIntentState` |

```typescript
// read-time upgrade of one stored intent
function upgrade(stored: any): TransactionIntent {
  const upgradeState = (state: any) => {
    if (!state) return undefined;
    const outcome = state.outcome ?? state.status;
    const final = typeof state.final === 'number' ? true : !!state.final;
    if (state.inclusion === 'Included') {
      return {
        inclusion: 'Included',
        outcome,
        final,
        // the old `final` value was the inclusion block's timestamp
        blockTimestamp:
          state.blockTimestamp ??
          (typeof state.final === 'number' ? state.final : undefined),
        via: state.via ?? {kind: 'attempt', attemptIndex: state.attemptIndex ?? 0},
      };
    }
    if (state.inclusion === 'Dropped') {
      return {inclusion: 'Dropped', final};
    }
    return {inclusion: state.inclusion};
  };

  return {
    ...stored,
    state: upgradeState(stored.state),
    transactions: stored.transactions.map((tx: any) => ({
      ...tx,
      // an old record never proved its nonce came from the chain
      nonceObserved: tx.nonceObserved === true,
      state: upgradeState(tx.state),
    })),
  };
}
```

Note that on a `Dropped` record the old `final` value was **not** a block timestamp (it was the broadcast time, or the finalized block's time), so it is dropped rather than migrated into `blockTimestamp`. `upgradeState` is written for the intent state; a transaction state has no `via`, so drop that key when you reuse it for `transactions[].state`.

Setting `nonceObserved` to `false` means a transaction whose nonce the observer never read back reverts to `NotFound` until it is seen on chain again, which is the honest state. If its supplied nonce is already spent in finalized history, the observer says so once and then stops polling it.

## Quick Start

```typescript
import { createTransactionObserver } from '@etherkit/tx-observer';
import type { TransactionIntent, BroadcastedTransaction, TransactionIntentEvent } from '@etherkit/tx-observer';

// Initialize the processor
const processor = createTransactionObserver({
  finality: 12, // blocks until considered final
  throttle: 5000, // optional: throttle process() calls
  provider: window.ethereum,
});

// Create an intent with one or more transactions
const intent: TransactionIntent = {
  transactions: [
    {
      hash: '0xabc...',
      from: '0x123...',
      chainId: 1,
      nonce: 5, // the nonce you INTENDED, see `nonceObserved` below
      broadcastTimestampMs: Date.now(),
    },
  ],
};

// Add the intent to tracking (ID is passed separately)
processor.add('my-intent-1', intent);

// Listen for intent state changes (for UI updates)
processor.on('intent:state', (event: TransactionIntentEvent) => {
  console.log(`Intent ${event.id}: ${event.intent.state?.inclusion}`);

  if (event.intent.state?.inclusion === 'Included') {
    console.log(`Outcome: ${event.intent.state.outcome}`); // 'Success' | 'Failure'
    console.log(`Final: ${event.intent.state.final}`); // boolean
    console.log(`Mined at: ${event.intent.state.blockTimestamp}`); // chain seconds

    // What proved the inclusion:
    if (event.intent.state.via.kind === 'attempt') {
      const winningTx =
        event.intent.transactions[event.intent.state.via.attemptIndex];
      console.log(`Winning TX: ${winningTx.hash}`);
    }
  }

  return () => {}; // cleanup function
});

// Listen for any transaction changes (for persistence)
processor.on('intent:updated', (event: TransactionIntentEvent) => {
  console.log(`Intent ${event.id} updated, save to storage`);
  return () => {}; // cleanup function
});

// Listen for new intents being added
processor.on('intents:added', (intents) => {
  console.log(`Added intents:`, Object.keys(intents));
  return () => {}; // cleanup function
});

// Process periodically (check for state updates)
setInterval(() => processor.process(), 5000);
```

## API Reference

### `createTransactionObserver(config)`

Creates a new transaction processor instance.

**Config:**

| Field | Type | Description |
|-------|------|-------------|
| `finality` | `number` | Number of blocks until a transaction is considered final |
| `throttle` | `number?` | Optional: throttle interval in ms for `process()` calls |
| `provider` | `EIP1193ProviderWithoutEvents?` | Optional Ethereum provider (can be set later) |
| `alwaysFetchReceipt` | `boolean?` | Fetch the receipt directly even when the tx view hides its block. Recovers mined txs from lagging/injected wallets (e.g. MetaMask on a restartable dev chain) that keep returning a stale pending view from `eth_getTransactionByHash` (`blockNumber: null`). Default `false`. |

**Returns:** Processor instance with the following methods:

#### `add(id: string, intent: TransactionIntent)`

Add an intent to track. If an intent with the same ID already exists, the transactions are merged into the existing intent.

```typescript
// Add new intent
processor.add('my-intent-1', intent);

// Add another transaction to existing intent (same ID merges)
processor.add('my-intent-1', {
  transactions: [bumpedTx], // New tx with higher gas
  // ... state fields
});
// and in case where you track the txs already you can simply re-add
intent.transactions.push(bumpedTx);
processor.add('my-intent-1', intent);
```

#### `addMultiple(intents: {[id: string]: TransactionIntent})`

Add multiple intents at once.

```typescript
processor.addMultiple({
  'intent-1': intent1,
  'intent-2': intent2,
});
```

#### `remove(intentId: string)`

Remove an intent by ID and stop tracking it.

```typescript
processor.remove('my-intent-1');
```

#### `clear()`

Remove all intents and **abort any in-flight processing**.

When `clear()` is called:
- All tracked intents are immediately removed
- Any ongoing `process()` call is aborted (no further RPC calls for the old intents)
- No events are emitted for intents from the previous session

This is essential for **account switching** scenarios where you need to ensure that transaction updates from the previous account don't leak into the new account's session.

```typescript
// Account switching example
function onAccountSwitch(newAccount: string, newIntents: Record<string, TransactionIntent>) {
  // Clear old account's intents - this aborts any in-flight processing
  processor.clear();
  
  // Add new account's intents
  processor.addMultiple(newIntents);
}
```

**Important:** Even if `process()` is currently running when `clear()` is called, no events will be emitted for the previous account's transactions. Any in-flight RPC calls will complete at the network level, but their results will be discarded.

#### `process(): Promise<void>`

Check and update the state of all tracked intents. This queries the Ethereum provider for transaction receipts and updates the intents accordingly.

A tick costs nothing when there is nothing to ask about: an intent whose transactions are all final, an intent from another chain, and a transaction the observer has given up on (see `nonceObserved`) are all skipped, and if that leaves no work, `process()` returns without a single request.

```typescript
await processor.process();
```

#### `setProvider(provider: EIP1193Provider)`

Update the Ethereum provider. This also re-reads `eth_chainId` and drops everything that was derived from the previous chain (the cached chain id, the last known block number, and any "nothing left to learn" verdicts).

**Call this when the wallet switches network.** The chain id is read once per provider, so an injected wallet that emits `chainChanged` without the app replacing the provider object would leave the observer comparing against the old chain:

```typescript
processor.setProvider(newProvider);

// injected wallet that switches network under you
window.ethereum.on('chainChanged', () => processor.setProvider(window.ethereum));
```

If the provider cannot answer `eth_chainId` at all, the chain check simply stays off (the observer does not ask again until `setProvider`), and intents are processed as if they carried no `chainId`.

#### `on(event, listener): () => void`

Subscribe to events. Returns a cleanup function to unsubscribe.

**Events:**

| Event | Payload | Description |
|-------|---------|-------------|
| `'intent:updated'` | `TransactionIntentEvent` | Fires when anything in the intent changes (for persistence) |
| `'intent:state'` | `TransactionIntentEvent` | Fires only when the intent state changes (for UI updates) |

`'intent:state'` is always accompanied by `'intent:updated'`: persisting on the latter can never leave you with a stored state the UI was never told about.
| `'intents:added'` | `TransactionIntentsAddedEvent` | Fires when intents are added via `add()` or `addMultiple()` |
| `'intents:removed'` | `TransactionIntentsRemovedEvent` | Fires when intents are removed via `remove()` |
| `'intents:cleared'` | `void` | Fires when all intents are cleared via `clear()` |

```typescript
// Subscribe to intent updates
const unsubscribe = processor.on('intent:updated', (event: TransactionIntentEvent) => {
  console.log(`Intent ${event.id} changed:`, event.intent);
  return () => {}; // cleanup
});

// Later, unsubscribe
unsubscribe();
```

#### `off(event, listener): void`

Unsubscribe from events.

```typescript
const listener = (event: TransactionIntentEvent) => {
  console.log(`Intent ${event.id} state:`, event.intent.state?.inclusion);
  return () => {};
};

processor.on('intent:state', listener);
// Later...
processor.off('intent:state', listener);
```

## Types

### `BroadcastedTransaction`

Represents a single broadcasted transaction.

```typescript
type BroadcastedTransaction = {
  chainId?: number;
  readonly hash: `0x${string}`;
  readonly from: `0x${string}`;
  nonce?: number;
  nonceObserved?: boolean;
  readonly broadcastTimestampMs: number;
  state?: BroadcastedTransactionState;
};

type BroadcastedTransactionState =
  | { inclusion: 'InMemPool' | 'NotFound' }
  | { inclusion: 'Dropped'; final: boolean }
  | { inclusion: 'Included'; outcome: 'Failure' | 'Success'; final: boolean; blockTimestamp?: number };
```

- `chainId`: when set and it does not match the provider's chain, the whole intent is skipped (and warned about once) instead of being resolved against the wrong chain.
- `nonce`: a value you supply is the **intended** nonce. A wallet may sign a different one, so it is not trusted for drop detection.
- `nonceObserved`: set by the observer once it read the nonce back from `eth_getTransactionByHash`. Only an observed nonce can make a transaction `Dropped`; without it the transaction stays `NotFound`. When such a transaction was never seen on chain and the supplied nonce is spent in finalized history, the observer stops polling it: the state stays `NotFound`, which is all it can honestly say, and it costs nothing from then on.
- `final`: a boolean, "past the finality depth".
- `blockTimestamp`: the inclusion block's timestamp, in the chain's own **seconds**, set as soon as the transaction is included (not only once final), so you can show "mined at" straight away. The milliseconds sibling is `broadcastTimestampMs`; nothing converts between the two.

### `TransactionIntentState`

The merged state of all transactions in an intent.

```typescript
type TransactionIntentState =
  | { inclusion: 'InMemPool' | 'NotFound' }
  | { inclusion: 'Dropped'; final: boolean }
  | {
      inclusion: 'Included';
      outcome: 'Failure' | 'Success';
      final: boolean;
      blockTimestamp?: number;
      via: {kind: 'attempt'; attemptIndex: number};
    }
  | {
      inclusion: 'Included';
      outcome: 'Success'; // an observed effect cannot prove a failure
      final: boolean;
      blockTimestamp?: number;
      via: {kind: 'expectedUpdate'; blockNumber: number};
    };
```

- `via` says what proved the inclusion. Switch on `via.kind`:
  - `'attempt'`: one of the intent's own transactions, at `via.attemptIndex` into `transactions[]`. The winning tx is `intent.transactions[via.attemptIndex]` (first success, or first failure if all failed).
  - `'expectedUpdate'`: an effect observed on chain that none of the intent's transactions produced, for instance a resubmission the user made in their wallet. There is no attempt to point at, which is why this is a union rather than an optional index. `blockNumber` is the block the effect was seen in: an attempt win recomputes `final` from its receipt every tick, but nothing can recompute it for an effect that was only sampled, so `final` comes from `latestBlockNumber - blockNumber >= finality`. It is recorded when the win is made, never passed to `add()`. (Detection is not implemented yet; the arm exists because the shape is persisted.)
- New `via` arms are additive: consumers switch on `kind`.

### `TransactionIntent`

An intent containing multiple transactions.

```typescript
type TransactionIntent = {
  transactions: BroadcastedTransaction[];
  state?: TransactionIntentState;
  expectedUpdate?: ExpectedUpdate;
};
```

### `ExpectedUpdate`

An effect on chain that satisfies the intent, whether or not one of the intent's own transactions produced it. **Detection is not implemented yet**; the shape is declared because consumers persist it.

```typescript
type ExpectedUpdate = {
  /** Lower bound for the log query. Filled by add() when absent. */
  fromBlock?: number;
  /** When the watch closes. The event can never arrive after it. */
  until?: {kind: 'block'; blockNumber: number} | {kind: 'chainTime'; timestampSeconds: number};
} & (
  | { address: `0x${string}`; event: {topics: `0x${string}`[]} }
  | { address: `0x${string}`; call: {data: `0x${string}`; result: `0x${string}`} }
);
```

- `fromBlock` is filled from the latest block the observer already polls, so creating an intent costs no extra RPC: by `add()` when a block is already known, otherwise by the first `process()` tick. The filled value is emitted on `intent:updated`. **Persist it**: refilling it on every reload would push the window past an event that landed while the app was closed.
- A watch can be attached to an intent that already exists (`add()` with the same id): an intent that has no watch adopts the incoming one. An existing watch is never replaced, since that would move its `fromBlock` forward.
- A stored `via: {kind: 'expectedUpdate'}` inclusion is never revisited: the observer cannot re-check an effect it did not see, so it keeps that state unless one of the intent's own attempts succeeds.
- `until` bounds the **watch**, not the query. The query is always `fromBlock..latest`; the watch simply stops once the latest block is past the bound. Both variants compare exactly against the latest block the observer already fetches (its number, or its timestamp), so nothing estimates block times.
- The `call` predicate must **latch**: once it holds it must never stop holding, because the observer only samples it and inclusion is never revisited.

### `TransactionIntentEvent`

Event payload emitted by listeners, includes both the intent ID and intent data.

```typescript
type TransactionIntentEvent = {
  id: string;
  intent: TransactionIntent;
};
```

### `TransactionIntentsAddedEvent`

Event payload emitted when intents are added.

```typescript
type TransactionIntentsAddedEvent = {
  [id: string]: TransactionIntent;
};
```

### `TransactionIntentsRemovedEvent`

Event payload emitted when intents are removed.

```typescript
type TransactionIntentsRemovedEvent = string[];
```

## Inclusion States

| Inclusion | Description |
|-----------|-------------|
| `InMemPool` | At least one transaction is visible in the mempool |
| `NotFound` | No transactions visible in mempool (may be temporary), or the intent has no transaction yet |
| `Dropped` | All transactions dropped: an **observed** nonce was used by another tx |
| `Included` | At least one transaction was included in a block |

## State Merging Logic

When an intent contains multiple transactions, their states are merged using the following priority (highest wins):

1. **Included** - Any tx included in a block → intent is `Included`
2. **InMemPool** - Any tx in mempool → intent is `InMemPool`
3. **NotFound** - None visible → intent is `NotFound`
4. **Dropped** - ALL txs dropped → intent is `Dropped`

An intent with **no transaction** is `NotFound`, not `Dropped`: nothing about it failed, it just has not been broadcast yet.

### For `Included` Intents

- If **any** transaction succeeded → `outcome: 'Success'`
- If **all** included transactions failed → `outcome: 'Failure'`
- `via.attemptIndex` points to the first successful tx, or first failure if all failed
- `final` and `blockTimestamp` come from that winning attempt

This allows scenarios like:
- Tx A (nonce 5) succeeds, Tx B (nonce 6) fails due to nonce conflict → Intent is **Success**
- Tx A (nonce 5, low gas) dropped, Tx B (nonce 5, high gas) succeeds → Intent is **Success**

## Use Cases

### Gas Price Bumping

When network congestion increases, submit a replacement transaction with the same nonce but higher gas price:

```typescript
// Initial transaction
const tx1: BroadcastedTransaction = {
  hash: '0x111...',
  from: '0xabc...',
  nonce: 5,
  broadcastTimestampMs: Date.now(),
  state: {
    inclusion: 'InMemPool',
  },
};

processor.add('transfer-1', {
  transactions: [tx1],
  state: {
    inclusion: 'InMemPool',
  },
});

// Later, bump gas price (same nonce)
const tx2: BroadcastedTransaction = {
  ...tx1,
  hash: '0x222...', // Different hash
};

processor.add('transfer-1', { // Same ID → merges
  transactions: [tx2],
});

// Intent now tracks both txs
// Whichever is included first determines the intent result
```

### Sequential Retry

If a transaction is stuck, retry with a new nonce:

```typescript
processor.add('my-action', {
  transactions: [
    { hash: '0x1...', from: '0xabc...', nonce: 5, broadcastTimestampMs: Date.now() }, // Original
    { hash: '0x2...', from: '0xabc...', nonce: 6, broadcastTimestampMs: Date.now() }, // Retry with new nonce
  ],
});

// If tx with nonce 5 succeeds, intent is Success
// Even if tx with nonce 6 fails (nonce conflict), intent is still Success
```

### Account Switching

When your application supports multiple accounts and the user switches between them, use `clear()` to safely transition:

```typescript
// Store intents per account (e.g., in localStorage or a database)
const intentsByAccount: Record<string, Record<string, TransactionIntent>> = {};

async function switchAccount(fromAccount: string, toAccount: string) {
  // 1. Clear current intents - this aborts any in-flight processing
  //    and prevents events from being emitted for the old account
  processor.clear();
  
  // 2. Load and add the new account's intents
  const newAccountIntents = intentsByAccount[toAccount] || {};
  processor.addMultiple(newAccountIntents);
  
  // 3. Process to get current status
  await processor.process();
}

// Listen for updates and persist to the correct account
processor.on('intent:updated', (event) => {
  // Get the current account from your app state
  const currentAccount = getCurrentAccount();
  
  // Persist only for the current account
  if (intentsByAccount[currentAccount]) {
    intentsByAccount[currentAccount][event.id] = event.intent;
    saveIntentsToStorage(currentAccount, intentsByAccount[currentAccount]);
  }
  
  return () => {};
});
```

**Key Point:** When `clear()` is called, any ongoing `process()` call is safely aborted. This prevents race conditions where transaction updates from Account A might be emitted while Account B's intents are active.
