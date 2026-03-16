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
