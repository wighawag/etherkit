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
	assertIntentDropped,
	assertIntentFinalized,
	assertTxInclusion,
	assertIntentTxCount,
	assertIntentIncluded,
} from '../helpers/assertions.js';
import {resetHashCounter, TEST_ACCOUNT} from '../fixtures/transactions.js';
import {resetIntentIdCounter} from '../fixtures/intents.js';

describe('Dropped Transaction Scenarios', () => {
	let setup: TestSetup;

	beforeEach(() => {
		resetHashCounter();
		resetIntentIdCounter();
		setup = createTestSetup({finality: 12});
	});

	afterEach(() => {
		setup.cleanup();
	});

	describe('Drop Detection', () => {
		it('dropped-nonce-consumed: Tx nonce is less than account nonce at finalized block', async () => {
			const nonce = 5;

			// Create intent with tx
			const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce,
			});
			const txHash = intent.transactions[0].hash;
			const account = intent.transactions[0].from;

			// Add to mempool and process
			addToMempool();
			await processAndWait(setup);
			const broadcastedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(broadcastedIntent!, 'InMemPool');

			// Tx disappears from mempool
			setup.controller.removeFromMempool(txHash);
			await processAndWait(setup);
			const notFoundIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(notFoundIntent!, 'NotFound');

			// External transaction consumes the nonce
			// Set account nonce higher than tx nonce
			setup.controller.setAccountNonce(account, nonce + 1);
			await processAndWait(setup);

			// Intent should now be Dropped
			const droppedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentDropped(droppedIntent!);
			assertIntentFinalized(droppedIntent!);
		});

		it('dropped-all-txs: All txs in intent are dropped', async () => {
			const nonce = 5;

			// Create intent with TX1
			const {
				intent,
				intentId,
				addToMempool: addTx1ToMempool,
			} = addSingleTxIntent(setup, {nonce});
			const tx1Hash = intent.transactions[0].hash;
			const account = intent.transactions[0].from;

			addTx1ToMempool();
			await processAndWait(setup);

			// Add TX2 with same nonce
			const {newTx: tx2, addToMempool: addTx2ToMempool} = addReplacementTx(
				setup,
				intentId,
				intent,
				{
					nonce,
					from: account,
				},
			);
			const tx2Hash = tx2.hash;
			addTx2ToMempool();
			await processAndWait(setup);

			// Both txs disappear from mempool
			setup.controller.removeFromMempool(tx1Hash);
			setup.controller.removeFromMempool(tx2Hash);
			await processAndWait(setup);

			// External transaction consumes the nonce
			setup.controller.setAccountNonce(account, nonce + 1);
			await processAndWait(setup);

			// Intent should be Dropped (all txs dropped)
			const droppedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentDropped(droppedIntent!);
			assertTxInclusion(droppedIntent!.transactions[0], 'Dropped');
			assertTxInclusion(droppedIntent!.transactions[1], 'Dropped');
		});

		it('dropped-one-of-many: One tx dropped, another still active', async () => {
			const nonce = 5;

			// Create intent with TX1
			const {
				intent,
				intentId,
				addToMempool: addTx1ToMempool,
			} = addSingleTxIntent(setup, {nonce});
			const tx1Hash = intent.transactions[0].hash;
			const account = intent.transactions[0].from;

			addTx1ToMempool();
			await processAndWait(setup);

			// Add TX2 with different nonce (can both be valid)
			const {newTx: tx2, addToMempool: addTx2ToMempool} = addReplacementTx(
				setup,
				intentId,
				intent,
				{
					nonce: nonce + 1,
					from: account,
				},
			);
			const tx2Hash = tx2.hash;
			addTx2ToMempool();
			await processAndWait(setup);

			// TX1 disappears, nonce consumed externally
			setup.controller.removeFromMempool(tx1Hash);
			setup.controller.setAccountNonce(account, nonce + 1);
			await processAndWait(setup);

			// TX1 is dropped but TX2 is still active
			const emittedIntent = getLatestEmissionForIntent(setup, intentId);
			assertTxInclusion(emittedIntent!.transactions[0], 'Dropped');
			assertTxInclusion(emittedIntent!.transactions[1], 'InMemPool');

			// Intent should NOT be Dropped - still has active tx
			assertIntentInclusion(emittedIntent!, 'InMemPool');
		});

		it('dropped-external-tx: Nonce consumed by tx not in our intent', async () => {
			const nonce = 5;

			// Create intent with tx
			const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce,
			});
			const account = intent.transactions[0].from;

			addToMempool();
			await processAndWait(setup);
			const broadcastedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(broadcastedIntent!, 'InMemPool');

			// Simulate external tx consuming nonce:
			// 1. Our tx disappears from mempool
			setup.controller.removeFromMempool(intent.transactions[0].hash);
			// 2. Account nonce advances (external tx was included)
			setup.controller.setAccountNonce(account, nonce + 1);

			await processAndWait(setup);

			// Our tx should be detected as dropped
			const droppedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentDropped(droppedIntent!);
		});

		it('dropped-timing: Drop detected with correct final timestamp', async () => {
			const nonce = 5;
			const broadcastTimestamp = Date.now();

			// Create intent with tx that has specific broadcast timestamp
			const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce,
				broadcastTimestamp,
			});
			const account = intent.transactions[0].from;

			addToMempool();
			await processAndWait(setup);

			// Remove from mempool and consume nonce
			setup.controller.removeFromMempool(intent.transactions[0].hash);
			setup.controller.setAccountNonce(account, nonce + 1);
			await processAndWait(setup);

			// Should be dropped with final timestamp
			const droppedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentDropped(droppedIntent!);
			expect(droppedIntent?.state?.final).toBeDefined();
			// Final should be the broadcast timestamp (from the tx)
			expect(droppedIntent?.state?.final).toBe(broadcastTimestamp);
		});
	});

	describe('Not Found vs Dropped Distinction', () => {
		it('notfound-temporary: Tx temporarily not visible, nonce still valid', async () => {
			const nonce = 5;

			// Create intent with tx
			const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce,
			});
			const account = intent.transactions[0].from;

			addToMempool();
			await processAndWait(setup);
			const broadcastedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(broadcastedIntent!, 'InMemPool');

			// Tx disappears but nonce still valid (not consumed)
			setup.controller.removeFromMempool(intent.transactions[0].hash);
			// Account nonce stays at nonce (not advanced)
			setup.controller.setAccountNonce(account, nonce);
			await processAndWait(setup);

			// Should be NotFound, not Dropped
			const notFoundIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(notFoundIntent!, 'NotFound');
			expect(notFoundIntent?.state?.final).toBeUndefined();
		});

		it('notfound-to-dropped: Tx not found, then nonce consumed', async () => {
			const nonce = 5;

			// Create intent with tx
			const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce,
			});
			const account = intent.transactions[0].from;

			addToMempool();
			await processAndWait(setup);

			// Tx disappears, nonce still valid
			setup.controller.removeFromMempool(intent.transactions[0].hash);
			setup.controller.setAccountNonce(account, nonce);
			await processAndWait(setup);
			const notFoundIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(notFoundIntent!, 'NotFound');

			// Later, nonce gets consumed
			setup.controller.setAccountNonce(account, nonce + 1);
			await processAndWait(setup);

			// Should transition to Dropped
			const droppedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentDropped(droppedIntent!);
		});

		it('notfound-to-broadcasted: Tx reappears in mempool', async () => {
			const nonce = 5;

			// Create intent with tx
			const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce,
			});

			addToMempool();
			await processAndWait(setup);
			const broadcastedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(broadcastedIntent!, 'InMemPool');

			// Tx temporarily disappears
			setup.controller.removeFromMempool(intent.transactions[0].hash);
			await processAndWait(setup);
			const notFoundIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(notFoundIntent!, 'NotFound');

			// Tx reappears (e.g., mempool resynced)
			addToMempool();
			await processAndWait(setup);

			// Should be back to Broadcasted
			const rebroadcastedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(rebroadcastedIntent!, 'InMemPool');
		});

		it('notfound-to-included: Tx not in mempool but appears in block', async () => {
			const nonce = 5;

			// Create intent with tx
			const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce,
			});
			const txHash = intent.transactions[0].hash;

			addToMempool();
			await processAndWait(setup);

			// Tx disappears from mempool
			setup.controller.removeFromMempool(txHash);
			await processAndWait(setup);
			const notFoundIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(notFoundIntent!, 'NotFound');

			// But then it appears in a block (was mined while we weren't looking)
			// Re-add to mempool so includeTx can find it
			addToMempool();
			setup.controller.includeTx(txHash, 'success');
			await processAndWait(setup);

			// Should be Included
			const includedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentIncluded(includedIntent!, 'Success');
		});
	});

	describe('Multiple Account Scenarios', () => {
		it('should handle intents from different accounts independently', async () => {
			const nonce1 = 5;
			const nonce2 = 3;

			// Intent 1 from account 1
			const {
				intent: intent1,
				intentId: intentId1,
				addToMempool: addTx1,
			} = addSingleTxIntent(setup, {
				nonce: nonce1,
				from: TEST_ACCOUNT,
			});

			// Intent 2 from account 2
			const account2 = '0xabcdef1234567890123456789012345678901234' as const;
			const {
				intent: intent2,
				intentId: intentId2,
				addToMempool: addTx2,
			} = addSingleTxIntent(setup, {
				nonce: nonce2,
				from: account2,
			});

			addTx1();
			addTx2();
			await processAndWait(setup);

			// Both should be broadcasted
			const emittedIntent1 = getLatestEmissionForIntent(setup, intentId1);
			const emittedIntent2 = getLatestEmissionForIntent(setup, intentId2);
			assertIntentInclusion(emittedIntent1!, 'InMemPool');
			assertIntentInclusion(emittedIntent2!, 'InMemPool');

			// Drop intent1's tx
			setup.controller.removeFromMempool(intent1.transactions[0].hash);
			setup.controller.setAccountNonce(TEST_ACCOUNT, nonce1 + 1);
			await processAndWait(setup);

			// Intent1 should be dropped, intent2 still broadcasted
			const droppedIntent1 = getLatestEmissionForIntent(setup, intentId1);
			const stillBroadcastedIntent2 = getLatestEmissionForIntent(
				setup,
				intentId2,
			);
			assertIntentDropped(droppedIntent1!);
			assertIntentInclusion(stillBroadcastedIntent2!, 'InMemPool');
		});
	});

	describe('Edge Cases', () => {
		it('should handle nonce 0 correctly', async () => {
			const nonce = 0;

			const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce,
			});
			const account = intent.transactions[0].from;

			addToMempool();
			await processAndWait(setup);
			const broadcastedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(broadcastedIntent!, 'InMemPool');

			// Remove and consume nonce 0
			setup.controller.removeFromMempool(intent.transactions[0].hash);
			setup.controller.setAccountNonce(account, 1);
			await processAndWait(setup);

			const droppedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentDropped(droppedIntent!);
		});

		it('should handle very high nonces', async () => {
			const nonce = 999999;

			const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce,
			});
			const account = intent.transactions[0].from;

			addToMempool();
			await processAndWait(setup);
			const broadcastedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(broadcastedIntent!, 'InMemPool');

			// Remove and consume high nonce
			setup.controller.removeFromMempool(intent.transactions[0].hash);
			setup.controller.setAccountNonce(account, nonce + 1);
			await processAndWait(setup);

			const droppedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentDropped(droppedIntent!);
		});
	});
});
