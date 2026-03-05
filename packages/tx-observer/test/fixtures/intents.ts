import type {
	TransactionIntent,
	BroadcastedTransaction,
} from '../../src/index.js';
import {createBroadcastedTx, TEST_ACCOUNT} from './transactions.js';

// Counter for generating unique intent IDs
let intentIdCounter = 0;

/**
 * Generate a unique intent ID
 */
export function generateIntentId(): string {
	intentIdCounter++;
	return `intent-${intentIdCounter}`;
}

/**
 * Reset the intent ID counter (call in beforeEach)
 */
export function resetIntentIdCounter(): void {
	intentIdCounter = 0;
}

/**
 * Create a TransactionIntent for testing
 */
export function createIntent(
	overrides: Partial<TransactionIntent> & {
		transactions?: BroadcastedTransaction[];
	} = {},
): TransactionIntent {
	// Default to one pending transaction if none provided
	const transactions = overrides.transactions || [createBroadcastedTx({})];

	return {
		transactions,
		state: overrides.state,
	};
}

/**
 * Create an intent with multiple transactions (for replacement scenarios)
 */
export function createMultiTxIntent(
	txConfigs: Array<Partial<BroadcastedTransaction>>,
	intentOverrides: Partial<TransactionIntent> = {},
): TransactionIntent {
	const transactions = txConfigs.map((config) => createBroadcastedTx(config));
	return createIntent({
		...intentOverrides,
		transactions,
	});
}

/**
 * Create an intent with a single transaction already broadcasted
 */
export function createBroadcastedIntent(
	txOverrides: Partial<BroadcastedTransaction> = {},
	intentOverrides: Partial<TransactionIntent> = {},
): TransactionIntent {
	const tx = createBroadcastedTx({
		...txOverrides,
		state: {inclusion: 'InMemPool', final: undefined, status: undefined},
	});
	return createIntent({
		...intentOverrides,
		transactions: [tx],
		state: {
			inclusion: 'InMemPool',
			final: undefined,
			status: undefined,
			attemptIndex: undefined,
		},
	});
}

/**
 * Create an intent with an included (successful) transaction
 */
export function createIncludedIntent(
	txOverrides: Partial<BroadcastedTransaction> = {},
	intentOverrides: Partial<TransactionIntent> = {},
): TransactionIntent {
	const tx = createBroadcastedTx({
		...txOverrides,
		state: {
			inclusion: 'Included',
			status: 'Success',
		},
	});
	return createIntent({
		...intentOverrides,
		transactions: [tx],
		state: {
			inclusion: 'Included',
			status: 'Success',
			attemptIndex: 0,
		},
	});
}

/**
 * Create an intent with a failed transaction
 */
export function createFailedIntent(
	txOverrides: Partial<BroadcastedTransaction> = {},
	intentOverrides: Partial<TransactionIntent> = {},
): TransactionIntent {
	const tx = createBroadcastedTx({
		...txOverrides,
		state: {
			inclusion: 'Included',
			status: 'Failure',
		},
	});
	return createIntent({
		...intentOverrides,
		transactions: [tx],
		state: {
			inclusion: 'Included',
			status: 'Failure',
			attemptIndex: 0,
		},
	});
}

/**
 * Create an intent with a dropped transaction
 */
export function createDroppedIntent(
	txOverrides: Partial<BroadcastedTransaction> = {},
	intentOverrides: Partial<TransactionIntent> = {},
): TransactionIntent {
	const tx = createBroadcastedTx({
		...txOverrides,
		state: {
			inclusion: 'Dropped',
			final: txOverrides.state?.final || Date.now(),
			status: undefined,
		},
	});
	return createIntent({
		...intentOverrides,
		transactions: [tx],
		state: {
			inclusion: 'Dropped',
			final: tx.state?.final,
			status: undefined,
			attemptIndex: undefined,
		},
	});
}

/**
 * Create an intent representing a gas bump scenario:
 * - Original TX with low gas
 * - Replacement TX with higher gas (same nonce)
 */
export function createGasBumpIntent(
	nonce: number = 5,
	intentOverrides: Partial<TransactionIntent> = {},
): {
	intent: TransactionIntent;
	originalTx: BroadcastedTransaction;
	replacementTx: BroadcastedTransaction;
} {
	const originalTx = createBroadcastedTx({
		nonce,
	});

	const replacementTx = createBroadcastedTx({
		nonce,
		from: originalTx.from,
	});

	const intent = createIntent({
		...intentOverrides,
		transactions: [originalTx, replacementTx],
	});

	return {intent, originalTx, replacementTx};
}

/**
 * Create a chain of replacement transactions (TX1 → TX2 → TX3)
 */
export function createReplacementChain(
	chainLength: number = 3,
	nonce: number = 5,
	intentOverrides: Partial<TransactionIntent> = {},
): {intent: TransactionIntent; transactions: BroadcastedTransaction[]} {
	const transactions: BroadcastedTransaction[] = [];

	for (let i = 0; i < chainLength; i++) {
		const gasMultiplier = i + 1;
		const tx = createBroadcastedTx({
			nonce,
			from: TEST_ACCOUNT,
		});
		transactions.push(tx);
	}

	const intent = createIntent({
		...intentOverrides,
		transactions,
	});

	return {intent, transactions};
}

/**
 * Sample intents for common test scenarios
 */
export const SAMPLE_INTENTS = {
	// Single pending intent
	pending: () => createIntent(),

	// Intent with broadcasted tx
	broadcasted: () => createBroadcastedIntent(),

	// Successfully included intent
	included: () => createIncludedIntent(),

	// Failed intent
	failed: () => createFailedIntent(),

	// Dropped intent
	dropped: () => createDroppedIntent(),

	// Gas bump scenario
	gasBump: () => createGasBumpIntent(),

	// Chain of replacements
	replacementChain: () => createReplacementChain(3),
};
