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
