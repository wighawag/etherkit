export type BroadcastedTransactionInclusion =
	| 'InMemPool'
	| 'NotFound'
	| 'Dropped'
	| 'Included';

/**
 * State of a single broadcasted transaction.
 *
 * Vocabulary (one word per level):
 * - `inclusion`: where the transaction is (mempool, block, gone).
 * - `outcome`: what the execution did once included (succeeded or reverted).
 * - `final`: whether the inclusion (or the drop) is past the finality depth.
 * - `blockTimestamp`: the inclusion block's timestamp, in the chain's own
 *   seconds. Set as soon as the transaction is included, not only once final,
 *   so a UI can show "mined at" before finality.
 */
export type BroadcastedTransactionState =
	| {
			inclusion: 'InMemPool' | 'NotFound';
			outcome?: never;
			final?: never;
			blockTimestamp?: never;
	  }
	| {
			inclusion: 'Dropped';
			/** True once the drop is past the finality depth. */
			final: boolean;
			outcome?: never;
			blockTimestamp?: never;
	  }
	| {
			inclusion: 'Included';
			/** Did the transaction succeed or revert. */
			outcome: 'Failure' | 'Success';
			/** True once the inclusion block is past the finality depth. */
			final: boolean;
			/**
			 * The inclusion block's timestamp, in the chain's own seconds.
			 * Not milliseconds: the sibling `broadcastTimestampMs` is the
			 * millisecond one, and nothing converts between them.
			 */
			blockTimestamp?: number;
	  };

export type BroadcastedTransaction = {
	/**
	 * The chain this transaction was broadcast to. When set and it does not
	 * match the provider's chain, the observer skips the whole intent instead
	 * of reporting a state computed against the wrong chain.
	 */
	chainId?: number;
	readonly hash: `0x${string}`;
	readonly from: `0x${string}`;
	/**
	 * The transaction's nonce.
	 *
	 * A value supplied by the consumer at broadcast time is the INTENDED nonce:
	 * the wallet is free to ignore it and sign a different one. It is therefore
	 * NOT trusted for drop detection until the observer has read it back from
	 * `eth_getTransactionByHash`, which is what `nonceObserved` records.
	 */
	nonce?: number;
	/**
	 * True once `nonce` came from the chain (`eth_getTransactionByHash`) rather
	 * than from the consumer. Only an observed nonce may declare a transaction
	 * `Dropped`; without it the transaction stays `NotFound`.
	 *
	 * A transaction whose hash was never seen on chain and whose supplied nonce
	 * is spent in finalized history stays `NotFound` for good: the observer
	 * stops polling it rather than guessing. That verdict is not stored here,
	 * because the observer never proved it; it is re-derived in one tick after
	 * a reload.
	 */
	nonceObserved?: boolean;
	readonly broadcastTimestampMs: number;
	state?: BroadcastedTransactionState;
};

/**
 * What proved an intent's inclusion.
 *
 * - `attempt`: one of the intent's own transactions, at `attemptIndex` into
 *   `transactions[]`. The hash is `intent.transactions[attemptIndex].hash`.
 * - `expectedUpdate`: an effect observed on chain (see {@link ExpectedUpdate})
 *   that no transaction of this intent produced, e.g. the same action sent
 *   from another device, or a resubmission the user made in their wallet.
 *   There is no `attemptIndex` to point at, which is exactly why this is a
 *   discriminated union rather than an optional index.
 *
 *   The observer never revisits an inclusion: a stored out-of-band win is kept
 *   unless one of the intent's own attempts succeeds, which points at a hash
 *   and is strictly more information.
 *
 * Adding an arm here is additive: consumers switch on `kind`. A foreseeable
 * future arm is `{kind: 'observed'; hash}` for a transaction found by scanning
 * the account's nonce range that the app never dispatched. It is deliberately
 * not declared until something emits it.
 */
export type TransactionIntentVia =
	| {kind: 'attempt'; attemptIndex: number}
	| {
			kind: 'expectedUpdate';
			/**
			 * The block the effect was seen in. Recorded when the win is created,
			 * never supplied by the caller of `add()`: for an `event` watch it is
			 * the matching log's own `blockNumber`; for a `call` watch it is the
			 * block the predicate was sampled at, which is an upper bound (the
			 * effect may have happened earlier, so finality measured from it waits
			 * a little longer, never less, which is why the predicate must latch).
			 *
			 * An attempt win recomputes `final` from its receipt's block on every
			 * tick; nothing can recompute it for an effect the observer only
			 * sampled, so this is what `final` is computed from:
			 * `latestBlockNumber - blockNumber >= finality`.
			 */
			blockNumber: number;
			attemptIndex?: never;
	  };

/**
 * An intent's state: the merged state of all its transactions, plus (later)
 * any out-of-band proof that the intent happened anyway.
 *
 * The `Included` arms are split by `via.kind` because an inclusion proved by
 * an {@link ExpectedUpdate} carries no `attemptIndex` and can only ever be a
 * `Success`: an observed effect proves something happened, it cannot prove a
 * failure.
 */
export type TransactionIntentState =
	| {
			inclusion: 'InMemPool' | 'NotFound';
			outcome?: never;
			final?: never;
			blockTimestamp?: never;
			via?: never;
	  }
	| {
			inclusion: 'Dropped';
			/** True once every transaction's drop is past the finality depth. */
			final: boolean;
			outcome?: never;
			blockTimestamp?: never;
			via?: never;
	  }
	| {
			inclusion: 'Included';
			outcome: 'Failure' | 'Success';
			final: boolean;
			/** The winning transaction's inclusion block timestamp, in chain seconds. */
			blockTimestamp?: number;
			via: Extract<TransactionIntentVia, {kind: 'attempt'}>;
	  }
	| {
			inclusion: 'Included';
			/** An observed effect cannot prove a failure. */
			outcome: 'Success';
			final: boolean;
			blockTimestamp?: number;
			via: Extract<TransactionIntentVia, {kind: 'expectedUpdate'}>;
	  };

/**
 * Where an out-of-band watch stops.
 *
 * Both variants are exact comparisons against the latest block the observer
 * already fetches (its `number`, or its `timestamp`), so nothing estimates
 * block times.
 *
 * Note for the (not yet implemented) detection pass: while an out-of-band
 * watch is still open, an intent whose transactions are ALL dropped must NOT
 * be reported as final. The expected effect can still arrive.
 */
export type ExpectedUpdateUntil =
	| {kind: 'block'; blockNumber: number}
	| {kind: 'chainTime'; timestampSeconds: number};

/**
 * An effect on chain that satisfies the intent, whether or not any of the
 * intent's own transactions produced it.
 *
 * Detection is not implemented yet; the fields exist now because consumers
 * persist this shape and each break costs them a migration.
 */
export type ExpectedUpdate = {
	/**
	 * Lower bound for the log query. Filled from the latest block the observer
	 * already polls when the caller did not supply one, so creating an intent
	 * costs no extra RPC: by `add()` when a block is already known, otherwise
	 * by the first `process()` tick, at that tick's block. Supply it yourself
	 * if the gap between creating the intent and the first tick matters.
	 *
	 * The filled value is emitted (`intent:updated`) so the consumer persists
	 * it: refilling it on every reload would push an event that landed while
	 * the app was closed permanently outside the window.
	 */
	fromBlock?: number;
	/**
	 * When the watch closes. The event can never arrive after it, so the
	 * observer simply stops watching once the latest block is past this bound.
	 *
	 * This bounds the WATCH, not the query: the query is always
	 * `fromBlock..latest`.
	 *
	 * Rule for the detection pass: while this watch is still open, an intent
	 * whose transactions are ALL dropped must NOT be reported as final: the
	 * expected effect can still arrive from somewhere else, e.g. from a
	 * resubmission the user made in their wallet.
	 *
	 * This is only decidable when `until` is set. An unbounded watch can never
	 * conclude that the effect will not arrive, so it must not hold finality
	 * open either: without `until`, the drop finalises as usual and the watch
	 * is best-effort, running for as long as the consumer keeps the intent.
	 */
	until?: ExpectedUpdateUntil;
} & (
	| {
			address: `0x${string}`;
			event: {topics: `0x${string}`[]};
			call?: never;
	  }
	| {
			address: `0x${string}`;
			event?: never;
			/**
			 * A call whose result signals that the intent happened.
			 *
			 * The predicate MUST LATCH: once `call(data) === result` holds it must
			 * never stop holding. The observer only samples it, and inclusion is
			 * never revisited, so a predicate that flips back would leave the
			 * intent reporting an inclusion that is no longer true.
			 */
			call: {data: `0x${string}`; result: `0x${string}`};
	  }
);

export type TransactionIntent = {
	transactions: BroadcastedTransaction[];
	state?: TransactionIntentState;

	// TODO, use these to detect out of band inclusion
	expectedUpdate?: ExpectedUpdate;
};

/**
 * Event payload that includes both the intent ID and the intent data.
 */
export type TransactionIntentEvent = {
	id: string;
	intent: TransactionIntent;
};

/**
 * Event payload for adding intents
 */
export type TransactionIntentsAddedEvent = {
	[id: string]: TransactionIntent;
};

/**
 * Event payload for adding intents
 */
export type TransactionIntentsRemovedEvent = string[];

/**
 * Deep readonly type to prevent direct mutation of nested data.
 */
export type DeepReadonly<T> = T extends (infer U)[]
	? ReadonlyArray<DeepReadonly<U>>
	: T extends Map<infer K, infer V>
		? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
		: T extends Set<infer U>
			? ReadonlySet<DeepReadonly<U>>
			: T extends object
				? {readonly [K in keyof T]: DeepReadonly<T[K]>}
				: T;

/**
 * Reverse of DeepReadonly. Removes 'readonly' from all nested properties.
 */
export type DeepWritable<T> =
	T extends ReadonlyMap<infer K, infer V>
		? Map<DeepWritable<K>, DeepWritable<V>>
		: T extends ReadonlySet<infer U>
			? Set<DeepWritable<U>>
			: T extends ReadonlyArray<infer U>
				? Array<DeepWritable<U>>
				: T extends object
					? {-readonly [K in keyof T]: DeepWritable<T[K]>}
					: T;

/**
 * Event map for TransactionObserver event subscriptions.
 */
export type TransactionObserverEventMap = {
	/** Anything changed, persist me. */
	'intent:updated': TransactionIntentEvent;
	/** The intent's state changed (for UI/state updates). */
	'intent:state': TransactionIntentEvent;
	'intents:added': TransactionIntentsAddedEvent;
	'intents:removed': TransactionIntentsRemovedEvent;
	'intents:cleared': void;
};

/**
 * TransactionObserver is the main interface for observing transaction intents.
 * Created via `createTransactionObserver()`.
 */
export type TransactionObserver = {
	/**
	 * Set or update the EIP-1193 provider used for blockchain queries.
	 * Also refreshes the cached chain id used to skip intents from another chain.
	 */
	setProvider(provider: import('eip-1193').EIP1193Provider): void;

	/**
	 * Remove a transaction intent by its ID.
	 */
	remove(intentId: string): void;

	/**
	 * Clear all transaction intents.
	 */
	clear(): void;

	/**
	 * Add a single transaction intent.
	 */
	add(id: string, intent: DeepReadonly<TransactionIntent>): void;

	/**
	 * Add multiple transaction intents at once.
	 */
	addMultiple(intents: DeepReadonly<{[id: string]: TransactionIntent}>): void;

	/**
	 * Process all transaction intents, checking their state on-chain.
	 */
	process(): Promise<void>;

	/**
	 * Subscribe to an event. Returns an unsubscribe function.
	 */
	on<K extends keyof TransactionObserverEventMap>(
		event: K,
		listener: (data: TransactionObserverEventMap[K]) => void,
	): () => void;

	/**
	 * Unsubscribe from an event.
	 */
	off<K extends keyof TransactionObserverEventMap>(
		event: K,
		listener: (data: TransactionObserverEventMap[K]) => void,
	): void;
};
