import {expect} from 'vitest';
import type {
	TransactionIntent,
	BroadcastedTransaction,
	BroadcastedTransactionInclusion,
} from '../../src/index.js';

/**
 * Assert that an intent has the expected inclusion status
 */
export function assertIntentInclusion(
	intent: TransactionIntent,
	expectedInclusion: BroadcastedTransactionInclusion,
	message?: string,
): void {
	expect(intent.state?.inclusion, message).toBe(expectedInclusion);
}

/**
 * Assert that an intent is in the Included state with the expected outcome,
 * proved by one of its own attempts.
 */
export function assertIntentIncluded(
	intent: TransactionIntent,
	expectedOutcome: 'Success' | 'Failure',
	message?: string,
): void {
	expect(intent.state?.inclusion, message).toBe('Included');
	expect(intent.state?.outcome, message).toBe(expectedOutcome);
	expect(intent.state?.via?.kind, message).toBe('attempt');
	expect(typeof intent.state?.via?.attemptIndex, message).toBe('number');
}

/**
 * Assert that an intent is finalized
 */
export function assertIntentFinalized(
	intent: TransactionIntent,
	message?: string,
): void {
	expect(intent.state?.final, message).toBe(true);
}

/**
 * Assert that an intent is dropped
 */
export function assertIntentDropped(
	intent: TransactionIntent,
	message?: string,
): void {
	expect(intent.state?.inclusion, message).toBe('Dropped');
}

/**
 * Assert that a transaction has the expected inclusion status
 */
export function assertTxInclusion(
	tx: BroadcastedTransaction,
	expectedInclusion: BroadcastedTransactionInclusion,
	message?: string,
): void {
	expect(tx.state?.inclusion, message).toBe(expectedInclusion);
}

/**
 * Assert that an intent contains a specific transaction hash
 */
export function assertIntentContainsTx(
	intent: TransactionIntent,
	txHash: `0x${string}`,
	message?: string,
): void {
	const found = intent.transactions.some((tx) => tx.hash === txHash);
	expect(found, message || `Intent should contain tx ${txHash}`).toBe(true);
}

/**
 * Assert that an intent has the expected number of transactions
 */
export function assertIntentTxCount(
	intent: TransactionIntent,
	expectedCount: number,
	message?: string,
): void {
	expect(
		intent.transactions.length,
		message || `Intent should have ${expectedCount} transactions`,
	).toBe(expectedCount);
}

/**
 * Assert that the winning attempt (via.attemptIndex) points to a specific hash
 */
export function assertWinningTx(
	intent: TransactionIntent,
	expectedHash: `0x${string}`,
	message?: string,
): void {
	const via = intent.state?.via;
	expect(via?.kind, 'intent should be proved by an attempt').toBe('attempt');
	const attemptIndex = via?.kind === 'attempt' ? via.attemptIndex : -1;
	const winningTx = intent.transactions[attemptIndex];
	expect(
		winningTx.hash,
		message || `Winning tx should be ${expectedHash}`,
	).toBe(expectedHash);
}

/**
 * Assert that all transactions in an intent have a specific inclusion status
 */
export function assertAllTxsInclusion(
	intent: TransactionIntent,
	expectedInclusion: BroadcastedTransactionInclusion,
	message?: string,
): void {
	for (const tx of intent.transactions) {
		expect(
			tx.state?.inclusion,
			message || `All txs should be ${expectedInclusion}`,
		).toBe(expectedInclusion);
	}
}

/**
 * Assert that at least one transaction has a specific inclusion status
 */
export function assertSomeTxInclusion(
	intent: TransactionIntent,
	expectedInclusion: BroadcastedTransactionInclusion,
	message?: string,
): void {
	const found = intent.transactions.some(
		(tx) => tx.state?.inclusion === expectedInclusion,
	);
	expect(
		found,
		message || `At least one tx should be ${expectedInclusion}`,
	).toBe(true);
}

/**
 * Assert emission sequence
 */
export function assertEmissionSequence(
	emissions: TransactionIntent[],
	expectedSequence: BroadcastedTransactionInclusion[],
	message?: string,
): void {
	expect(
		emissions.length,
		message || 'Emission count should match expected sequence',
	).toBe(expectedSequence.length);

	for (let i = 0; i < expectedSequence.length; i++) {
		expect(
			emissions[i].state?.inclusion,
			message || `Emission ${i} should be ${expectedSequence[i]}`,
		).toBe(expectedSequence[i]);
	}
}

/**
 * Assert that an emission contains a newly added transaction
 * (Critical for local state handler consistency)
 */
export function assertEmissionContainsNewTx(
	emission: TransactionIntent,
	newTxHash: `0x${string}`,
	message?: string,
): void {
	assertIntentContainsTx(
		emission,
		newTxHash,
		message ||
			`Emission must contain newly added tx ${newTxHash} for state handler consistency`,
	);
}

/**
 * Assert that the latest emission in a list contains a transaction
 */
export function assertLatestEmissionContainsTx(
	emissions: TransactionIntent[],
	txHash: `0x${string}`,
	message?: string,
): void {
	expect(emissions.length, 'Should have at least one emission').toBeGreaterThan(
		0,
	);
	const latestEmission = emissions[emissions.length - 1];
	assertIntentContainsTx(latestEmission, txHash, message);
}

/**
 * Assert intent state matches expected values
 */
export function assertIntentState(
	intent: TransactionIntent,
	expected: {
		inclusion: BroadcastedTransactionInclusion;
		outcome?: 'Success' | 'Failure';
		final?: boolean;
		attemptIndex?: number;
	},
	message?: string,
): void {
	expect(intent.state?.inclusion, message).toBe(expected.inclusion);

	if (expected.outcome !== undefined) {
		expect(intent.state?.outcome, message).toBe(expected.outcome);
	}

	if (expected.final !== undefined) {
		expect(intent.state?.final, message).toBe(expected.final);
	} else if (
		expected.inclusion === 'InMemPool' ||
		expected.inclusion === 'NotFound'
	) {
		expect(intent.state?.final, message).toBeUndefined();
	}

	if (expected.attemptIndex !== undefined) {
		const via = intent.state?.via;
		expect(via?.kind, message).toBe('attempt');
		expect(
			via?.kind === 'attempt' ? via.attemptIndex : undefined,
			message,
		).toBe(expected.attemptIndex);
	}
}
