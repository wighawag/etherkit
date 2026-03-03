/**
 * Critical Consistency Tests for Local State Handler
 *
 * These tests verify the guarantee from plans/testing-plan.md:
 * "After addMultiple() returns, any subsequent operation event MUST include the newly added transaction."
 *
 * The potential race condition:
 * 1. process() starts iterating over op.transactions (snapshot or live)
 * 2. While iterating, addMultiple() is called with a new TX
 * 3. The new TX is pushed to op.transactions
 * 4. process() continues/finishes iteration
 * 5. computeOperationStatus() is called
 *
 * The guarantee: computeOperationStatus() must use ALL current transactions,
 * including any added during iteration.
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	initTransactionProcessor,
	type OnchainOperation,
	type OnchainOperationEvent,
} from '../../src/index.js';
import {
	createMockProvider,
	type MockProviderController,
} from '../mocks/MockEIP1193Provider.js';
import {
	createBroadcastedTx,
	createMockTx,
	resetHashCounter,
	TEST_ACCOUNT,
} from '../fixtures/transactions.js';
import {createOperation, resetOpIdCounter} from '../fixtures/operations.js';

describe('Consistency Guarantee with Local State Handler', () => {
	let processor: ReturnType<typeof initTransactionProcessor>;
	let controller: MockProviderController;
	let emissions: OnchainOperation[];
	let emissionEvents: OnchainOperationEvent[];
	let cleanup: () => void;

	beforeEach(() => {
		resetHashCounter();
		resetOpIdCounter();

		const {provider, controller: ctrl} = createMockProvider();
		controller = ctrl;

		processor = initTransactionProcessor({
			finality: 12,
			provider,
		});

		emissions = [];
		emissionEvents = [];
		cleanup = processor.onOperationUpdated((event) => {
			emissions.push(structuredClone(event.operation));
			emissionEvents.push(structuredClone(event));
			return () => {};
		});
	});

	afterEach(() => {
		cleanup();
	});

	// Helper to get latest emission for an operation ID
	function getLatestEmission(opId: string): OnchainOperation | undefined {
		for (let i = emissionEvents.length - 1; i >= 0; i--) {
			if (emissionEvents[i].id === opId) {
				return emissionEvents[i].operation;
			}
		}
		return undefined;
	}

	describe('Race Condition: Add during Process Iteration', () => {
		it('CRITICAL: New TX added mid-iteration MUST be in emitted status', async () => {
			const tx1 = createBroadcastedTx({nonce: 5});
			const mockTx1 = createMockTx({
				hash: tx1.hash,
				from: tx1.from,
				nonce: 5,
			});
			const op = createOperation({transactions: [tx1]});

			controller.addToMempool(mockTx1);
			processor.addMultiple({'consistency-test': op});

			await processor.process();
			const emittedOp = getLatestEmission('consistency-test');
			expect(emittedOp?.state?.inclusion).toBe('InMemPool');

			const tx2 = createBroadcastedTx({nonce: 5, from: TEST_ACCOUNT});
			const mockTx2 = createMockTx({
				hash: tx2.hash,
				from: tx2.from,
				nonce: 5,
				maxFeePerGas: '0x77359400',
			});

			let injected = false;
			const removeHook = controller.onRequest(
				async (method: string, params: unknown[]) => {
					if (
						method === 'eth_getTransactionByHash' &&
						params[0] === tx1.hash &&
						!injected
					) {
						injected = true;
						controller.addToMempool(mockTx2);
						processor.addMultiple({
							'consistency-test': {...op, transactions: [tx2]},
						});
					}
				},
			);

			controller.includeTx(tx1.hash, 'success');
			controller.setAccountNonce(TEST_ACCOUNT, 6);

			await processor.process();
			removeHook();

			const includedEmission = emissions.find(
				(e) => e.state?.inclusion === 'Included',
			);

			expect(includedEmission).toBeDefined();
			expect(includedEmission!.transactions.length).toBe(2);

			const tx1InEmission = includedEmission!.transactions.some(
				(t) => t.hash === tx1.hash,
			);
			const tx2InEmission = includedEmission!.transactions.some(
				(t) => t.hash === tx2.hash,
			);

			expect(tx1InEmission).toBe(true);
			expect(tx2InEmission).toBe(true);
		});

		it('CRITICAL: Status computation must use ALL transactions, not iteration snapshot', async () => {
			const tx1 = createBroadcastedTx({nonce: 5});
			const mockTx1 = createMockTx({
				hash: tx1.hash,
				from: tx1.from,
				nonce: 5,
			});
			const op = createOperation({transactions: [tx1]});

			controller.addToMempool(mockTx1);
			processor.addMultiple({'snapshot-test': op});
			await processor.process();
			const emittedOp = getLatestEmission('snapshot-test');
			expect(emittedOp?.state?.inclusion).toBe('InMemPool');

			const emissionCountBefore = emissions.length;

			const tx2 = createBroadcastedTx({nonce: 5, from: TEST_ACCOUNT});
			const mockTx2 = createMockTx({
				hash: tx2.hash,
				from: tx2.from,
				nonce: 5,
			});

			let added = false;
			const removeHook = controller.onRequest(async () => {
				if (!added) {
					added = true;
					controller.addToMempool(mockTx2);
					processor.addMultiple({
						'snapshot-test': {...op, transactions: [tx2]},
					});
				}
			});

			controller.includeTx(tx1.hash, 'success');
			controller.setAccountNonce(TEST_ACCOUNT, 6);

			await processor.process();
			removeHook();

			// Verify there's a new emission
			expect(emissions.length).toBeGreaterThan(emissionCountBefore);

			const newEmissions = emissions.slice(emissionCountBefore);
			expect(newEmissions.length).toBeGreaterThan(0);

			const latestEmission = newEmissions[newEmissions.length - 1];
			expect(latestEmission.transactions.length).toBe(2);
			expect(latestEmission.transactions.some((t) => t.hash === tx1.hash)).toBe(
				true,
			);
			expect(latestEmission.transactions.some((t) => t.hash === tx2.hash)).toBe(
				true,
			);
		});

		it('CRITICAL: Add between process start and event emission', async () => {
			const tx1 = createBroadcastedTx({nonce: 5});
			const mockTx1 = createMockTx({
				hash: tx1.hash,
				from: tx1.from,
				nonce: 5,
			});
			const op = createOperation({transactions: [tx1]});

			controller.addToMempool(mockTx1);
			processor.addMultiple({'mid-iteration-add': op});
			await processor.process();

			const emissionCountBefore = emissions.length;

			const tx2 = createBroadcastedTx({nonce: 6, from: TEST_ACCOUNT});
			const mockTx2 = createMockTx({
				hash: tx2.hash,
				from: tx2.from,
				nonce: 6,
			});

			let injected = false;
			const removeHook = controller.onBeforeResponse(
				'eth_getTransactionByHash',
				() => {
					if (!injected) {
						injected = true;
						controller.addToMempool(mockTx2);
						processor.addMultiple({
							'mid-iteration-add': {...op, transactions: [tx2]},
						});
					}
				},
			);

			controller.includeTx(tx1.hash, 'success');
			controller.setAccountNonce(TEST_ACCOUNT, 6);

			await processor.process();
			removeHook();

			expect(emissions.length).toBeGreaterThan(emissionCountBefore);

			const relevantEmissions = emissions.slice(emissionCountBefore);
			const hasCompleteEmission = relevantEmissions.some(
				(e) => e.transactions.length === 2,
			);

			expect(hasCompleteEmission).toBe(true);
		});
	});

	describe('Snapshot Iteration Verification', () => {
		it('should process all existing TXs even if iteration uses snapshot', async () => {
			const tx1 = createBroadcastedTx({nonce: 5});
			const mockTx1 = createMockTx({
				hash: tx1.hash,
				from: tx1.from,
				nonce: 5,
			});
			const tx2 = createBroadcastedTx({nonce: 6, from: TEST_ACCOUNT});
			const mockTx2 = createMockTx({
				hash: tx2.hash,
				from: tx2.from,
				nonce: 6,
			});

			const op = createOperation({transactions: [tx1, tx2]});

			controller.addToMempool(mockTx1);
			controller.addToMempool(mockTx2);
			processor.addMultiple({'multi-tx': op});

			await processor.process();

			const emittedOp = getLatestEmission('multi-tx');
			expect(emittedOp?.transactions[0].state?.inclusion).toBe('InMemPool');
			expect(emittedOp?.transactions[1].state?.inclusion).toBe('InMemPool');
			expect(emittedOp?.state?.inclusion).toBe('InMemPool');
		});

		it('should correctly compute merged status with multiple TXs', async () => {
			const tx1 = createBroadcastedTx({nonce: 5});
			const mockTx1 = createMockTx({
				hash: tx1.hash,
				from: tx1.from,
				nonce: 5,
			});
			const tx2 = createBroadcastedTx({nonce: 6, from: TEST_ACCOUNT});
			const mockTx2 = createMockTx({
				hash: tx2.hash,
				from: tx2.from,
				nonce: 6,
			});

			const op = createOperation({transactions: [tx1, tx2]});

			controller.addToMempool(mockTx1);
			controller.addToMempool(mockTx2);
			processor.addMultiple({'merged-status': op});
			await processor.process();

			controller.includeTx(tx1.hash, 'success');
			controller.setAccountNonce(TEST_ACCOUNT, 6);
			await processor.process();

			const emittedOp = getLatestEmission('merged-status');
			expect(emittedOp?.state?.inclusion).toBe('Included');
			expect(emittedOp?.state?.status).toBe('Success');
			expect(emittedOp?.state?.txIndex).toBe(0);
		});
	});
});
