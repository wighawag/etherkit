# @etherkit/tx-observer

A TypeScript library for monitoring Ethereum transaction intents containing multiple transactions, with automatic status merging and finality tracking.

## Overview

The Transaction Processor tracks **intents** - logical groupings of transactions that belong together. This is useful when:

- **Gas price bumping**: Multiple transactions with the same nonce but different gas prices
- **Sequential retries**: Transactions with different nonces for the same logical action
- **Multi-step intents**: Related transactions that form a single user action

The processor monitors all transactions in an intent and computes a merged status, emitting events when the intent status changes.

## Installation

```bash
npm install @etherkit/tx-observer
```

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
      nonce: 5,
      broadcastTimestamp: Date.now(),
    },
  ],
};

// Add the intent to tracking (ID is passed separately)
processor.add('my-intent-1', intent);

// Listen for intent status changes (for UI updates)
processor.on('intent:status', (event: TransactionIntentEvent) => {
  console.log(`Intent ${event.id}: ${event.intent.state?.inclusion}`);
  
  if (event.intent.state?.inclusion === 'Included') {
    const winningTx = event.intent.transactions[event.intent.state.attemptIndex];
    console.log(`Status: ${event.intent.state.status}`);
    console.log(`Winning TX: ${winningTx.hash}`);
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

// Process periodically (check for status updates)
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

Check and update the status of all tracked intents. This queries the Ethereum provider for transaction receipts and updates statuses accordingly.

```typescript
await processor.process();
```

#### `setProvider(provider: EIP1193Provider)`

Update the Ethereum provider.

```typescript
processor.setProvider(newProvider);
```

#### `on(event, listener): () => void`

Subscribe to events. Returns a cleanup function to unsubscribe.

**Events:**

| Event | Payload | Description |
|-------|---------|-------------|
| `'intent:updated'` | `TransactionIntentEvent` | Fires when any transaction in the intent changes (for persistence) |
| `'intent:status'` | `TransactionIntentEvent` | Fires only when intent status changes (for UI updates) |
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
  console.log(`Intent ${event.id} status:`, event.intent.state?.inclusion);
  return () => {};
};

processor.on('intent:status', listener);
// Later...
processor.off('intent:status', listener);
```

## Types

### `BroadcastedTransaction`

Represents a single broadcasted transaction.

```typescript
type BroadcastedTransaction = {
  readonly hash: `0x${string}`;
  readonly from: `0x${string}`;
  nonce?: number;
  readonly broadcastTimestamp: number;
  state?: BroadcastedTransactionState;
};

type BroadcastedTransactionState =
  | { inclusion: 'InMemPool' | 'NotFound'; final: undefined; status: undefined }
  | { inclusion: 'Dropped'; final?: number; status: undefined }
  | { inclusion: 'Included'; status: 'Failure' | 'Success'; final?: number };
```

### `TransactionIntentStatus`

The merged status of all transactions in an intent.

```typescript
type TransactionIntentStatus =
  | { inclusion: 'InMemPool' | 'NotFound'; final: undefined; status: undefined; attemptIndex: undefined }
  | { inclusion: 'Dropped'; final?: number; status: undefined; attemptIndex: undefined }
  | { inclusion: 'Included'; status: 'Failure' | 'Success'; final?: number; attemptIndex: number };
```

- `attemptIndex`: Index into `transactions[]` for the "winning" transaction (first success, or first failure if all failed)
- Get the winning tx hash via: `intent.transactions[intent.state.attemptIndex].hash`

### `TransactionIntent`

An intent containing multiple transactions.

```typescript
type TransactionIntent = {
  transactions: BroadcastedTransaction[];
  state?: TransactionIntentStatus;
};
```

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

## Status States

| Inclusion | Description |
|-----------|-------------|
| `InMemPool` | At least one transaction is visible in the mempool |
| `NotFound` | No transactions visible in mempool (may be temporary) |
| `Dropped` | All transactions dropped (nonce was used by external tx) |
| `Included` | At least one transaction was included in a block |

## Status Merging Logic

When an intent contains multiple transactions, their statuses are merged using the following priority (highest wins):

1. **Included** - Any tx included in a block → intent is `Included`
2. **InMemPool** - Any tx in mempool → intent is `InMemPool`
3. **NotFound** - None visible → intent is `NotFound`
4. **Dropped** - ALL txs dropped → intent is `Dropped`

### For `Included` Intents

- If **any** transaction succeeded → `status: 'Success'`
- If **all** included transactions failed → `status: 'Failure'`
- `attemptIndex` points to the first successful tx, or first failure if all failed

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
  broadcastTimestamp: Date.now(),
  state: {
    inclusion: 'InMemPool',
    status: undefined,
    final: undefined,
  },
};

processor.add('transfer-1', {
  transactions: [tx1],
  state: {
    inclusion: 'InMemPool',
    status: undefined,
    final: undefined,
    attemptIndex: undefined,
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
    { hash: '0x1...', from: '0xabc...', nonce: 5, broadcastTimestamp: Date.now() }, // Original
    { hash: '0x2...', from: '0xabc...', nonce: 6, broadcastTimestamp: Date.now() }, // Retry with new nonce
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
