export type BroadcastedTransactionInclusion =
	| 'InMemPool'
	| 'NotFound'
	| 'Dropped'
	| 'Included';

export type BroadcastedTransactionState =
	| {
			inclusion: 'InMemPool' | 'NotFound';
			final: undefined;
			status: undefined;
	  }
	| {
			inclusion: 'Dropped';
			final?: number;
			status: undefined;
	  }
	| {
			inclusion: 'Included';
			status: 'Failure' | 'Success';
			final?: number;
	  };

export type BroadcastedTransaction = {
	chainId?: number;
	readonly hash: `0x${string}`;
	readonly from: `0x${string}`;
	nonce?: number;
	readonly broadcastTimestampMs: number;
	state?: BroadcastedTransactionState;
};

/**
 * transaction's intent status represents the merged status of all transactions in an intent.
 * - attemptIndex: index into transactions[] for the "winning" tx (first success, or first failure if all failed)
 * - The hash can be retrieved via: intent.transactions[intent.attemptIndex].hash
 */
export type TransactionIntentStatus =
	| {
			inclusion: 'InMemPool' | 'NotFound';
			final: undefined;
			status: undefined;
			attemptIndex: undefined;
	  }
	| {
			inclusion: 'Dropped';
			final?: number;
			status: undefined;
			attemptIndex: undefined;
	  }
	| {
			inclusion: 'Included';
			status: 'Failure' | 'Success';
			final?: number;
			attemptIndex: number;
	  };

export type ExpectedUpdate =
	| {
			address: `0x${string}`;
			event: {topics: `0x${string}`[]};
	  }
	| {
			address: `0x${string}`;
			call: {data: `0x${string}`; result: `0x${string}`};
	  };

export type TransactionIntent = {
	transactions: BroadcastedTransaction[];
	state?: TransactionIntentStatus;

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
	'intent:updated': TransactionIntentEvent;
	'intent:status': TransactionIntentEvent;
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
	 * Process all transaction intents, checking their status on-chain.
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
