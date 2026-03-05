import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	createTestSetup,
	addSingleTxIntent,
	processAndWait,
	getLatestEmissionForIntent,
	type TestSetup,
} from '../helpers/scenarios.js';
import {
	assertIntentContainsTx,
	assertLatestEmissionContainsTx,
	assertEmissionContainsNewTx,
} from '../helpers/assertions.js';
import {
	resetHashCounter,
	createBroadcastedTx,
	createMockTx,
	TEST_ACCOUNT,
} from '../fixtures/transactions.js';
import {resetIntentIdCounter, createIntent} from '../fixtures/intents.js';
import type {TransactionIntent} from '../../src/index.js';

describe('Concurrent Add Tests - Consistency with Local State Handler', () => {
	let setup: TestSetup;

	beforeEach(() => {
		resetHashCounter();
		resetIntentIdCounter();
		setup = createTestSetup({finality: 12});
	});

	afterEach(() => {
		setup.cleanup();
	});

	describe('Event Completeness Guarantee', () => {
		it('should include newly added tx in all subsequent events', async () => {
			// This is the critical test for local state handler use case:
			// After addMultiple() returns, any subsequent intent event MUST include
			// the newly added transaction.

			// Initial intent with TX1
			const tx1 = createBroadcastedTx({nonce: 5});
			const mockTx1 = createMockTx({
				hash: tx1.hash,
				from: tx1.from,
				nonce: 5,
			});
			const intent = createIntent({transactions: [tx1]});

			setup.controller.addToMempool(mockTx1);
			setup.processor.addMultiple({intent1: intent});

			// Start processing - TX1 becomes Broadcasted
			await setup.processor.process();

			// LOCAL STATE HANDLER: User bumps gas, saves to disk, then adds
			// This simulates: localStorage.save(intentWithTx2); processor.addMultiple(...)
			const tx2 = createBroadcastedTx({
				nonce: 5,
				from: TEST_ACCOUNT,
			});
			const mockTx2 = createMockTx({
				hash: tx2.hash,
				from: tx2.from,
				nonce: 5,
				maxFeePerGas: '0x77359400', // Higher gas
			});
			setup.controller.addToMempool(mockTx2);
			setup.processor.addMultiple({intent1: {...intent, transactions: [tx2]}});

			// Include TX2 to trigger a state change
			setup.controller.includeTx(tx2.hash, 'success');

			// Process again - now there's a state change (Broadcasted -> Included)
			await setup.processor.process();

			// CRITICAL: The emitted intent MUST contain both TXs
			// This allows state handler to safely overwrite local state
			const lastEmission = setup.emissions[setup.emissions.length - 1];
			expect(lastEmission.transactions).toHaveLength(2);
			assertEmissionContainsNewTx(lastEmission, tx2.hash);
			assertEmissionContainsNewTx(lastEmission, tx1.hash);
		});

		it('should handle add called between process start and event emission', async () => {
			// TX2 added just before event would be emitted

			const tx1 = createBroadcastedTx({nonce: 5});
			const mockTx1 = createMockTx({
				hash: tx1.hash,
				from: tx1.from,
				nonce: 5,
			});
			const intent = createIntent({transactions: [tx1]});

			setup.controller.addToMempool(mockTx1);
			setup.processor.addMultiple({intent1: intent});

			// Use a hook to inject tx2 mid-process
			const tx2 = createBroadcastedTx({nonce: 5, from: TEST_ACCOUNT});
			const mockTx2 = createMockTx({
				hash: tx2.hash,
				from: tx2.from,
				nonce: 5,
			});

			let hookCalled = false;
			const removeHook = setup.controller.onBeforeResponse(
				'eth_getTransactionByHash',
				() => {
					if (!hookCalled) {
						hookCalled = true;
						setup.controller.addToMempool(mockTx2);
						setup.processor.addMultiple({
							intent1: {...intent, transactions: [tx2]},
						});
					}
				},
			);

			await setup.processor.process();

			removeHook();

			// TX2 must be in the emissions
			const hasEmissionWithTx2 = setup.emissions.some((emission) =>
				emission.transactions.some((t) => t.hash === tx2.hash),
			);
			expect(hasEmissionWithTx2).toBe(true);

			// And should contain tx1 as well
			const hasEmissionWithBothTx = setup.emissions.some(
				(emission) =>
					emission.transactions.some((t) => t.hash === tx1.hash) &&
					emission.transactions.some((t) => t.hash === tx2.hash),
			);
			expect(hasEmissionWithBothTx).toBe(true);
		});
	});

	describe('Concurrent Add During Process', () => {
		it('concurrent-add-during-process: Call add with new tx while process is running', async () => {
			const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			addToMempool();

			// Start process
			const processPromise = setup.processor.process();

			// Add new tx during process
			const tx2 = createBroadcastedTx({
				nonce: 5,
				from: TEST_ACCOUNT,
			});
			const mockTx2 = createMockTx({
				hash: tx2.hash,
				from: tx2.from,
				nonce: 5,
				maxFeePerGas: '0x77359400',
			});
			setup.controller.addToMempool(mockTx2);
			setup.processor.addMultiple({
				[intentId]: {...intent, transactions: [tx2]},
			});

			await processPromise;

			// New tx should be in the latest emission
			const latestEmission = getLatestEmissionForIntent(setup, intentId);
			expect(latestEmission?.transactions.length).toBe(2);
			assertIntentContainsTx(latestEmission!, tx2.hash);
		});

		it('concurrent-add-same-id-during-process: Add intent with same ID during process', async () => {
			const tx1 = createBroadcastedTx({nonce: 5});
			const mockTx1 = createMockTx({
				hash: tx1.hash,
				from: tx1.from,
				nonce: 5,
			});
			const intent = createIntent({transactions: [tx1]});

			setup.controller.addToMempool(mockTx1);
			setup.processor.addMultiple({'shared-id': intent});

			// Start process
			const processPromise = setup.processor.process();

			// Add different tx to same intent ID
			const tx2 = createBroadcastedTx({nonce: 6, from: TEST_ACCOUNT});
			const mockTx2 = createMockTx({
				hash: tx2.hash,
				from: tx2.from,
				nonce: 6,
			});
			setup.controller.addToMempool(mockTx2);
			setup.processor.addMultiple({
				'shared-id': {
					transactions: [tx2],
				},
			});

			await processPromise;

			// Both txs should be merged in the emission
			const latestEmission = getLatestEmissionForIntent(setup, 'shared-id');
			expect(latestEmission?.transactions).toHaveLength(2);
			assertIntentContainsTx(latestEmission!, tx1.hash);
			assertIntentContainsTx(latestEmission!, tx2.hash);
		});

		it('concurrent-multiple-adds: Multiple rapid adds to same intent', async () => {
			const tx1 = createBroadcastedTx({nonce: 5});
			const mockTx1 = createMockTx({
				hash: tx1.hash,
				from: tx1.from,
				nonce: 5,
			});
			const intent = createIntent({transactions: [tx1]});

			setup.controller.addToMempool(mockTx1);
			setup.processor.addMultiple({'rapid-adds': intent});

			const processPromise = setup.processor.process();

			// Rapidly add multiple txs
			const additionalTxs: ReturnType<typeof createBroadcastedTx>[] = [];
			for (let i = 0; i < 5; i++) {
				const tx = createBroadcastedTx({nonce: 6 + i, from: TEST_ACCOUNT});
				const mockTx = createMockTx({
					hash: tx.hash,
					from: tx.from,
					nonce: 6 + i,
				});
				setup.controller.addToMempool(mockTx);
				setup.processor.addMultiple({
					'rapid-adds': {...intent, transactions: [tx]},
				});
				additionalTxs.push(tx);
			}

			await processPromise;

			// All txs should be in the latest emission
			const latestEmission = getLatestEmissionForIntent(setup, 'rapid-adds');
			expect(latestEmission?.transactions.length).toBe(6); // 1 original + 5 added
			for (const tx of additionalTxs) {
				assertIntentContainsTx(latestEmission!, tx.hash);
			}
		});

		it('concurrent-add-then-include: Add new tx, original tx gets included', async () => {
			const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			const tx1Hash = intent.transactions[0].hash;
			addToMempool();

			// Process to see TX1 broadcasted
			await setup.processor.process();

			// Start another process
			const processPromise = setup.processor.process();

			// Add TX2 while processing
			const tx2 = createBroadcastedTx({nonce: 5, from: TEST_ACCOUNT});
			const mockTx2 = createMockTx({
				hash: tx2.hash,
				from: tx2.from,
				nonce: 5,
			});
			setup.controller.addToMempool(mockTx2);
			setup.processor.addMultiple({
				[intentId]: {...intent, transactions: [tx2]},
			});

			// TX1 gets included
			setup.controller.includeTx(tx1Hash, 'success');

			await processPromise;

			// Event should contain both txs
			const finalEmission = setup.emissions[setup.emissions.length - 1];
			expect(finalEmission.transactions.length).toBe(2);
			assertIntentContainsTx(finalEmission, tx1Hash);
			assertIntentContainsTx(finalEmission, tx2.hash);
		});
	});

	describe('Remove During Process', () => {
		it('concurrent-remove-during-process: Remove intent while being processed', async () => {
			const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			addToMempool();

			const initialEmissionCount = setup.emissions.length;

			// Use hook to remove during process
			let removed = false;
			const removeHook = setup.controller.onBeforeResponse(
				'eth_getTransactionByHash',
				() => {
					if (!removed) {
						removed = true;
						setup.processor.remove(intentId);
					}
				},
			);

			await setup.processor.process();

			removeHook();

			// Should not emit events for removed intent
			// The intent was removed mid-process, so no new emissions should occur
			expect(setup.emissions.length).toBe(initialEmissionCount);
		});
	});

	describe('State Handler Integration Pattern', () => {
		it('should support save-then-add pattern', async () => {
			// This test simulates the exact pattern used by local state handlers:
			// 1. Save intent to disk immediately
			// 2. Call processor.addMultiple()
			// 3. Listen for intent events
			// 4. Save updated state from events

			const emissions: TransactionIntent[] = [];

			// State handler listens for events
			const cleanup = setup.processor.onOperationUpdated((event) => {
				emissions.push(structuredClone(event.intent));
				return () => {};
			});

			// Step 1: Create and "save" intent with TX1
			const tx1 = createBroadcastedTx({nonce: 5});
			const mockTx1 = createMockTx({
				hash: tx1.hash,
				from: tx1.from,
				nonce: 5,
			});
			const savedIntent = createIntent({
				transactions: [tx1],
			});
			// Simulate: localStorage.setItem('intents', JSON.stringify([savedIntent]));

			// Step 2: Add to processor
			setup.controller.addToMempool(mockTx1);
			setup.processor.addMultiple({'state-handler-intent': savedIntent});

			await setup.processor.process();

			// Step 3: User bumps gas
			const tx2 = createBroadcastedTx({
				nonce: 5,
				from: TEST_ACCOUNT,
			});
			const mockTx2 = createMockTx({
				hash: tx2.hash,
				from: tx2.from,
				nonce: 5,
				maxFeePerGas: '0x77359400',
			});

			// Simulate: savedIntent.transactions.push(tx2);
			// Simulate: localStorage.setItem('intents', JSON.stringify([savedIntent]));

			// Add to processor
			setup.controller.addToMempool(mockTx2);
			setup.processor.addMultiple({
				'state-handler-intent': {...savedIntent, transactions: [tx2]},
			});

			// Include TX2 to trigger a status change
			setup.controller.includeTx(tx2.hash, 'success');

			await setup.processor.process();

			// Step 4: Verify event contains both txs
			// State handler can safely use this to update local storage
			const lastEmission = emissions[emissions.length - 1];
			expect(lastEmission.transactions.length).toBe(2);
			assertIntentContainsTx(lastEmission, tx1.hash);
			assertIntentContainsTx(lastEmission, tx2.hash);

			cleanup();
		});

		it('should ensure no data loss when event overwrites local state', async () => {
			// Critical test: If state handler overwrites local state with event data,
			// no transactions should be lost

			const tx1 = createBroadcastedTx({nonce: 5});
			const mockTx1 = createMockTx({
				hash: tx1.hash,
				from: tx1.from,
				nonce: 5,
			});
			const intent = createIntent({transactions: [tx1]});

			setup.controller.addToMempool(mockTx1);
			setup.processor.addMultiple({'no-data-loss': intent});

			// Process to get first emission
			await setup.processor.process();

			// Add TX2 and process
			const tx2 = createBroadcastedTx({nonce: 5, from: TEST_ACCOUNT});
			const mockTx2 = createMockTx({
				hash: tx2.hash,
				from: tx2.from,
				nonce: 5,
			});
			setup.controller.addToMempool(mockTx2);
			setup.processor.addMultiple({
				'no-data-loss': {...intent, transactions: [tx2]},
			});

			// Include TX1 to trigger a status change, which will emit both txs
			setup.controller.includeTx(tx1.hash, 'success');

			await setup.processor.process();

			// Get final emission
			const finalEmission = setup.emissions[setup.emissions.length - 1];

			// Verify no data loss - both txs present
			const tx1Present = finalEmission.transactions.some(
				(t) => t.hash === tx1.hash,
			);
			const tx2Present = finalEmission.transactions.some(
				(t) => t.hash === tx2.hash,
			);

			expect(tx1Present).toBe(true);
			expect(tx2Present).toBe(true);
			expect(finalEmission.transactions.length).toBe(2);
		});
	});
});
