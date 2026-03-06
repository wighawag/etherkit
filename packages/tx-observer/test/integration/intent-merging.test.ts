import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	createTestSetup,
	addSingleTxIntent,
	addReplacementTx,
	processAndWait,
	getLatestEmissionForIntent,
	type TestSetup,
} from '../helpers/scenarios.js';
import {
	assertIntentInclusion,
	assertIntentIncluded,
	assertIntentDropped,
} from '../helpers/assertions.js';
import {resetHashCounter, TEST_ACCOUNT} from '../fixtures/transactions.js';
import {resetIntentIdCounter, createIntent} from '../fixtures/intents.js';
import {createBroadcastedTx} from '../fixtures/transactions.js';

describe('Intent Status Merging', () => {
	let setup: TestSetup;

	beforeEach(() => {
		resetHashCounter();
		resetIntentIdCounter();
		setup = createTestSetup({finality: 12});
	});

	afterEach(() => {
		setup.cleanup();
	});

	describe('Status Priority', () => {
		it('merge-all-broadcasted: All txs in mempool → Broadcasted', async () => {
			// Create intent with multiple txs
			const {
				intent,
				intentId,
				addToMempool: addTx1,
			} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			addTx1();

			const {addToMempool: addTx2} = addReplacementTx(setup, intentId, intent, {
				nonce: 6,
				from: TEST_ACCOUNT,
			});
			addTx2();

			await processAndWait(setup);

			const emittedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(emittedIntent!, 'InMemPool');
		});

		it('merge-one-included-success: One tx succeeded, others pending → Included/Success', async () => {
			const {
				intent,
				intentId,
				addToMempool: addTx1,
			} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			const tx1Hash = intent.transactions[0].hash;
			addTx1();

			const {addToMempool: addTx2} = addReplacementTx(setup, intentId, intent, {
				nonce: 6,
				from: TEST_ACCOUNT,
			});
			addTx2();

			await processAndWait(setup);

			// Include TX1 as success
			setup.controller.includeTx(tx1Hash, 'success');
			await processAndWait(setup);

			// Intent should be Included/Success (one success wins)
			const emittedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentIncluded(emittedIntent!, 'Success');
			expect(emittedIntent?.state?.attemptIndex).toBe(0);
		});

		it('merge-one-included-failure: One tx failed, others pending → Included/Failure', async () => {
			const {
				intent,
				intentId,
				addToMempool: addTx1,
			} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			const tx1Hash = intent.transactions[0].hash;
			addTx1();

			const {addToMempool: addTx2} = addReplacementTx(setup, intentId, intent, {
				nonce: 6,
				from: TEST_ACCOUNT,
			});
			addTx2();

			await processAndWait(setup);

			// Include TX1 as failure
			setup.controller.includeTx(tx1Hash, 'failure');
			await processAndWait(setup);

			// Intent should be Included/Failure
			const emittedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentIncluded(emittedIntent!, 'Failure');
		});

		it('merge-mixed-included: One success, one failure → Included/Success', async () => {
			const {
				intent,
				intentId,
				addToMempool: addTx1,
			} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			const tx1Hash = intent.transactions[0].hash;
			addTx1();

			const {newTx: tx2, addToMempool: addTx2} = addReplacementTx(
				setup,
				intentId,
				intent,
				{
					nonce: 6,
					from: TEST_ACCOUNT,
				},
			);
			const tx2Hash = tx2.hash;
			addTx2();

			await processAndWait(setup);

			// TX1 fails
			setup.controller.includeTx(tx1Hash, 'failure');
			await processAndWait(setup);

			// TX2 succeeds
			setup.controller.includeTx(tx2Hash, 'success');
			await processAndWait(setup);

			// Success should win over failure
			const emittedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentIncluded(emittedIntent!, 'Success');
			expect(emittedIntent?.state?.attemptIndex).toBe(1); // TX2 index
		});

		it('merge-all-dropped: All txs dropped → Dropped', async () => {
			const {
				intent,
				intentId,
				addToMempool: addTx1,
			} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			const tx1Hash = intent.transactions[0].hash;
			addTx1();

			const {newTx: tx2, addToMempool: addTx2} = addReplacementTx(
				setup,
				intentId,
				intent,
				{
					nonce: 5, // Same nonce
					from: TEST_ACCOUNT,
				},
			);
			const tx2Hash = tx2.hash;
			addTx2();

			await processAndWait(setup);

			// Remove both from mempool
			setup.controller.removeFromMempool(tx1Hash);
			setup.controller.removeFromMempool(tx2Hash);

			// Consume nonce externally
			setup.controller.setAccountNonce(TEST_ACCOUNT, 6);
			await processAndWait(setup);

			const emittedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentDropped(emittedIntent!);
		});

		it('merge-priority-order: Included > Broadcasted > BeingFetched > NotFound > Dropped', async () => {
			// Test that included status takes priority over all others

			const {
				intent,
				intentId,
				addToMempool: addTx1,
			} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			const tx1Hash = intent.transactions[0].hash;

			// TX1 not in mempool yet
			await processAndWait(setup);
			const notFoundIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(notFoundIntent!, 'NotFound');

			// Add TX2 to mempool
			const {addToMempool: addTx2} = addReplacementTx(setup, intentId, intent, {
				nonce: 6,
				from: TEST_ACCOUNT,
			});
			addTx2();
			await processAndWait(setup);

			// Should be Broadcasted (TX2 is broadcasted, TX1 is NotFound)
			const broadcastedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(broadcastedIntent!, 'InMemPool');

			// Include TX1 directly (skipping mempool)
			addTx1();
			setup.controller.includeTx(tx1Hash, 'success');
			await processAndWait(setup);

			// Should be Included (highest priority)
			const includedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentIncluded(includedIntent!, 'Success');
		});
	});

	describe('Transaction Index Selection', () => {
		it('should select first successful tx as attemptIndex', async () => {
			const {
				intent,
				intentId,
				addToMempool: addTx1,
			} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			const tx1Hash = intent.transactions[0].hash;
			addTx1();

			const {newTx: tx2, addToMempool: addTx2} = addReplacementTx(
				setup,
				intentId,
				intent,
				{
					nonce: 6,
					from: TEST_ACCOUNT,
				},
			);
			const tx2Hash = tx2.hash;
			addTx2();

			const {newTx: tx3, addToMempool: addTx3} = addReplacementTx(
				setup,
				intentId,
				intent,
				{
					nonce: 7,
					from: TEST_ACCOUNT,
				},
			);
			const tx3Hash = tx3.hash;
			addTx3();

			await processAndWait(setup);

			// TX2 succeeds first (middle tx)
			setup.controller.includeTx(tx2Hash, 'success');
			await processAndWait(setup);

			// attemptIndex should point to TX2 (index 1)
			const emittedIntent = getLatestEmissionForIntent(setup, intentId);
			expect(emittedIntent?.state?.attemptIndex).toBe(1);
			expect(
				emittedIntent?.transactions[emittedIntent?.state?.attemptIndex!].hash,
			).toBe(tx2Hash);
		});

		it('should select first failure if no success', async () => {
			const {
				intent,
				intentId,
				addToMempool: addTx1,
			} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			const tx1Hash = intent.transactions[0].hash;
			addTx1();

			const {newTx: tx2, addToMempool: addTx2} = addReplacementTx(
				setup,
				intentId,
				intent,
				{
					nonce: 6,
					from: TEST_ACCOUNT,
				},
			);
			const tx2Hash = tx2.hash;
			addTx2();

			await processAndWait(setup);

			// TX2 fails first
			setup.controller.includeTx(tx2Hash, 'failure');
			await processAndWait(setup);

			// TX1 also fails
			setup.controller.includeTx(tx1Hash, 'failure');
			await processAndWait(setup);

			// attemptIndex should point to first failure (TX1, index 0)
			const emittedIntent = getLatestEmissionForIntent(setup, intentId);
			expect(emittedIntent?.state?.attemptIndex).toBe(0);
		});

		it('should update attemptIndex when success arrives after failure', async () => {
			const {
				intent,
				intentId,
				addToMempool: addTx1,
			} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			const tx1Hash = intent.transactions[0].hash;
			addTx1();

			const {newTx: tx2, addToMempool: addTx2} = addReplacementTx(
				setup,
				intentId,
				intent,
				{
					nonce: 6,
					from: TEST_ACCOUNT,
				},
			);
			const tx2Hash = tx2.hash;
			addTx2();

			await processAndWait(setup);

			// TX1 fails
			setup.controller.includeTx(tx1Hash, 'failure');
			await processAndWait(setup);
			const failedIntent = getLatestEmissionForIntent(setup, intentId);
			expect(failedIntent?.state?.attemptIndex).toBe(0);

			// TX2 succeeds
			setup.controller.includeTx(tx2Hash, 'success');
			await processAndWait(setup);

			// attemptIndex should now point to success (TX2)
			const successIntent = getLatestEmissionForIntent(setup, intentId);
			expect(successIntent?.state?.attemptIndex).toBe(1);
		});
	});

	describe('Finality Handling', () => {
		it('should use most recent final timestamp from included txs', async () => {
			const {
				intent,
				intentId,
				addToMempool: addTx1,
			} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			const tx1Hash = intent.transactions[0].hash;
			addTx1();

			const {newTx: tx2, addToMempool: addTx2} = addReplacementTx(
				setup,
				intentId,
				intent,
				{
					nonce: 6,
					from: TEST_ACCOUNT,
				},
			);
			const tx2Hash = tx2.hash;
			addTx2();

			await processAndWait(setup);

			// Include TX1
			setup.controller.includeTx(tx1Hash, 'success');
			await processAndWait(setup);

			// Include TX2 in next block
			setup.controller.includeTx(tx2Hash, 'success');
			await processAndWait(setup);

			// Advance to finality for both
			setup.controller.advanceBlocks(12);
			await processAndWait(setup);

			// Intent should be finalized
			const finalizedIntent = getLatestEmissionForIntent(setup, intentId);
			expect(finalizedIntent?.state?.final).toBeDefined();
		});
	});

	describe('Edge Cases', () => {
		it('should handle empty transactions array', async () => {
			const intent = createIntent({
				transactions: [],
			});

			setup.processor.addMultiple({'test-empty': intent});
			await processAndWait(setup);

			// With no transactions, the intent stays at initial state
			// (no txs to process means no status change)
			// Check emissions - no emission should have occurred for this intent
			const emittedIntent = getLatestEmissionForIntent(setup, 'test-empty');
			expect(emittedIntent).toBeUndefined();
		});

		it('should handle single transaction intent', async () => {
			const {intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce: 5,
			});

			addToMempool();
			await processAndWait(setup);

			const emittedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(emittedIntent!, 'InMemPool');
			expect(emittedIntent?.transactions).toHaveLength(1);
		});

		it('should deduplicate transactions with same hash', async () => {
			const tx = createBroadcastedTx({nonce: 5});
			const intent = createIntent({
				transactions: [tx],
			});

			setup.processor.addMultiple({'dedup-test': intent});

			// Try to add same tx again
			setup.processor.addMultiple({
				'dedup-test': {
					...intent,
					transactions: [tx], // Same tx
				},
			});

			// We need to check the emitted intent, but since it's just adding without processing,
			// let's process and check the emissions
			await processAndWait(setup);

			const emittedIntent = getLatestEmissionForIntent(setup, 'dedup-test');
			// Should still have only one tx
			expect(emittedIntent?.transactions).toHaveLength(1);
		});

		it('should merge intents with same ID', async () => {
			const tx1 = createBroadcastedTx({nonce: 5});
			const intent = createIntent({
				transactions: [tx1],
			});

			setup.processor.addMultiple({'same-intent-id': intent});

			// Add another tx to same intent
			const tx2 = createBroadcastedTx({nonce: 6});
			setup.processor.addMultiple({
				'same-intent-id': {
					transactions: [tx2],
				},
			});

			// Process and check emissions
			await processAndWait(setup);

			const emittedIntent = getLatestEmissionForIntent(setup, 'same-intent-id');
			// Should have both txs
			expect(emittedIntent?.transactions).toHaveLength(2);
			expect(emittedIntent?.transactions[0].hash).toBe(tx1.hash);
			expect(emittedIntent?.transactions[1].hash).toBe(tx2.hash);
		});
	});
});
