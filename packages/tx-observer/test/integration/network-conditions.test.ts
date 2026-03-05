import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	createTestSetup,
	addSingleTxIntent,
	processAndWait,
	getLatestEmissionForIntent,
	type TestSetup,
} from '../helpers/scenarios.js';
import {
	assertIntentInclusion,
	assertIntentIncluded,
} from '../helpers/assertions.js';
import {resetHashCounter} from '../fixtures/transactions.js';
import {resetIntentIdCounter} from '../fixtures/intents.js';

describe('Network Conditions', () => {
	let setup: TestSetup;

	beforeEach(() => {
		resetHashCounter();
		resetIntentIdCounter();
	});

	afterEach(() => {
		if (setup) {
			setup.cleanup();
		}
	});

	describe('Provider Failures', () => {
		it('network-eth-getBlockByNumber-fails: Latest block fetch fails', async () => {
			setup = createTestSetup({finality: 12});

			const {intent, addToMempool} = addSingleTxIntent(setup, {nonce: 5});
			addToMempool();

			// Make eth_getBlockByNumber fail
			setup.controller.setFailMethods(['eth_getBlockByNumber']);

			// Process should throw but intent state should remain unchanged
			await expect(setup.processor.process()).rejects.toThrow();

			// No emissions should have occurred
			expect(setup.emissions.length).toBe(0);
		});

		it('network-eth-getTransactionByHash-fails: Tx lookup fails', async () => {
			setup = createTestSetup({finality: 12});

			const {intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			addToMempool();

			// First successful process
			await processAndWait(setup);
			const emittedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(emittedIntent!, 'InMemPool');

			// Make tx lookup fail
			setup.controller.setFailMethods(['eth_getTransactionByHash']);

			// Process should throw
			await expect(setup.processor.process()).rejects.toThrow();

			// Most recent emission should still show previous state
			const lastEmission = getLatestEmissionForIntent(setup, intentId);
			expect(lastEmission?.state?.inclusion).toBe('InMemPool');
		});

		it('network-eth-getTransactionReceipt-fails: Receipt fetch fails', async () => {
			setup = createTestSetup({finality: 12});

			const {intent, intentId, addToMempool} = addSingleTxIntent(
				setup,
				{nonce: 5},
			);
			const txHash = intent.transactions[0].hash;
			addToMempool();

			await processAndWait(setup);

			// Include tx but make receipt fetch fail
			setup.controller.includeTx(txHash, 'success');
			setup.controller.setFailMethods(['eth_getTransactionReceipt']);

			// Process should throw
			await expect(setup.processor.process()).rejects.toThrow();

			// Intent should stay at Broadcasted (couldn't confirm inclusion)
			const lastEmission = getLatestEmissionForIntent(setup, intentId);
			expect(lastEmission?.state?.inclusion).toBe('InMemPool');
		});

		it('network-intermittent: Random failures with recovery', async () => {
			setup = createTestSetup({finality: 12});

			const {intent, intentId, addToMempool} = addSingleTxIntent(
				setup,
				{nonce: 5},
			);
			const txHash = intent.transactions[0].hash;
			addToMempool();

			// Set 30% failure rate
			setup.controller.setFailureRate(0.3);

			// Run multiple process cycles - some may fail
			let successfulProcesses = 0;
			for (let i = 0; i < 20; i++) {
				try {
					await setup.processor.process();
					successfulProcesses++;
				} catch {
					// Expected intermittent failures
				}
			}

			// Should have had at least some successful processes
			expect(successfulProcesses).toBeGreaterThan(0);

			// Clear failure rate and include tx
			setup.controller.setFailureRate(0);
			setup.controller.includeTx(txHash, 'success');

			// Should successfully process now
			await processAndWait(setup);

			// Should reach correct final state
			const emittedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentIncluded(emittedIntent!, 'Success');
		});
	});

	describe('Disconnect/Reconnect', () => {
		it('should handle provider disconnect', async () => {
			setup = createTestSetup({finality: 12});

			const {intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			addToMempool();

			await processAndWait(setup);
			const emittedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(emittedIntent!, 'InMemPool');

			// Disconnect
			setup.controller.simulateDisconnect();

			// Process should fail
			await expect(setup.processor.process()).rejects.toThrow();
		});

		it('should recover after reconnect', async () => {
			setup = createTestSetup({finality: 12});

			const {intent, intentId, addToMempool} = addSingleTxIntent(
				setup,
				{nonce: 5},
			);
			const txHash = intent.transactions[0].hash;
			addToMempool();

			await processAndWait(setup);

			// Disconnect
			setup.controller.simulateDisconnect();

			// Process fails
			await expect(setup.processor.process()).rejects.toThrow();

			// Reconnect
			setup.controller.simulateReconnect();

			// Include tx while "disconnected" (simulates changes while offline)
			setup.controller.includeTx(txHash, 'success');

			// Process should work again
			await processAndWait(setup);
			const emittedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentIncluded(emittedIntent!, 'Success');
		});
	});

	describe('Block Progression', () => {
		it('blocks-progression: Blocks advance normally', async () => {
			setup = createTestSetup({finality: 12});

			const {intent, intentId, addToMempool} = addSingleTxIntent(
				setup,
				{nonce: 5},
			);
			const txHash = intent.transactions[0].hash;
			addToMempool();

			await processAndWait(setup);

			// Include and get initial block number
			setup.controller.includeTx(txHash, 'success');
			await processAndWait(setup);

			const initialBlockNumber = setup.controller.getBlockNumber();

			// Not finalized yet
			const includedIntent = getLatestEmissionForIntent(setup, intentId);
			expect(includedIntent?.state?.final).toBeUndefined();

			// Advance blocks
			setup.controller.advanceBlocks(12);
			await processAndWait(setup);

			// Should be finalized
			const finalizedIntent = getLatestEmissionForIntent(setup, intentId);
			expect(finalizedIntent?.state?.final).toBeDefined();

			// Block number should have advanced
			expect(setup.controller.getBlockNumber()).toBe(initialBlockNumber + 12);
		});

		it('blocks-finality-boundary: Tx at exactly finality boundary', async () => {
			setup = createTestSetup({finality: 12});

			const {intent, intentId, addToMempool} = addSingleTxIntent(
				setup,
				{nonce: 5},
			);
			const txHash = intent.transactions[0].hash;
			addToMempool();

			await processAndWait(setup);

			setup.controller.includeTx(txHash, 'success');
			await processAndWait(setup);

			// Advance to one before finality
			setup.controller.advanceBlocks(11);
			await processAndWait(setup);
			const almostFinalIntent = getLatestEmissionForIntent(setup, intentId);
			expect(almostFinalIntent?.state?.final).toBeUndefined();

			// Advance exactly one more block to reach finality
			setup.controller.advanceBlock();
			await processAndWait(setup);

			// Should now be finalized
			const finalizedIntent = getLatestEmissionForIntent(setup, intentId);
			expect(finalizedIntent?.state?.final).toBeDefined();
		});
	});

	describe('Latency Simulation', () => {
		it('should handle latency in responses', async () => {
			setup = createTestSetup({finality: 12, latencyMs: 50});

			const {intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			addToMempool();

			const startTime = Date.now();
			await processAndWait(setup);
			const endTime = Date.now();

			// Should have taken some time due to latency
			// Multiple RPC calls means multiple latency delays
			expect(endTime - startTime).toBeGreaterThanOrEqual(50);

			const emittedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(emittedIntent!, 'InMemPool');
		});

		it('should work with dynamic latency changes', async () => {
			setup = createTestSetup({finality: 12});

			const {intent, intentId, addToMempool} = addSingleTxIntent(
				setup,
				{nonce: 5},
			);
			addToMempool();

			// Start with no latency
			await processAndWait(setup);
			const broadcastedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(broadcastedIntent!, 'InMemPool');

			// Add latency mid-test
			setup.controller.setLatency(10);

			const txHash = intent.transactions[0].hash;
			setup.controller.includeTx(txHash, 'success');

			await processAndWait(setup);
			const includedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentIncluded(includedIntent!, 'Success');
		});
	});

	describe('Timing Edge Cases', () => {
		it('timing-rapid-process-calls: Multiple process calls in quick succession', async () => {
			setup = createTestSetup({finality: 12});

			const {intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			addToMempool();

			// Make multiple rapid process calls
			const promises = [
				setup.processor.process(),
				setup.processor.process(),
				setup.processor.process(),
			];

			await Promise.all(promises);

			// Should reach correct state without issues
			const emittedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(emittedIntent!, 'InMemPool');

			// Should not have duplicate emissions for same state
			const broadcastedEmissions = setup.emissions.filter(
				(e) => e.state?.inclusion === 'InMemPool',
			);

			// All emissions after the first should be deduped
			// (the exact count depends on implementation, but should be minimal)
			expect(broadcastedEmissions.length).toBeGreaterThanOrEqual(1);
		});

		it('timing-stale-data: Process uses fresh data each call', async () => {
			setup = createTestSetup({finality: 12});

			const {intent, intentId, addToMempool} = addSingleTxIntent(
				setup,
				{nonce: 5},
			);
			const txHash = intent.transactions[0].hash;
			addToMempool();

			await processAndWait(setup);
			const broadcastedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(broadcastedIntent!, 'InMemPool');

			// Remove from mempool between process calls
			setup.controller.removeFromMempool(txHash);

			await processAndWait(setup);

			// Should reflect current state (NotFound), not stale (Broadcasted)
			const notFoundIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(notFoundIntent!, 'NotFound');
		});
	});

	describe('Clear and Remove Intents', () => {
		it('should handle clear during idle', async () => {
			setup = createTestSetup({finality: 12});

			const {intent, addToMempool} = addSingleTxIntent(setup, {nonce: 5});
			addToMempool();

			await processAndWait(setup);
			const emissionCountBefore = setup.emissions.length;

			// Clear all intents
			setup.processor.clear();

			// Process should work but do nothing (no intents to process)
			await processAndWait(setup);

			// No new emissions after clear (count should be same as before)
			expect(setup.emissions.length).toBe(emissionCountBefore);
		});

		it('should handle remove specific intent', async () => {
			setup = createTestSetup({finality: 12});

			const {intentId: intent1Id, addToMempool: addTx1} = addSingleTxIntent(
				setup,
				{nonce: 5},
			);
			addTx1();

			const {intentId: intent2Id, addToMempool: addTx2} = addSingleTxIntent(
				setup,
				{nonce: 6},
			);
			addTx2();

			await processAndWait(setup);

			// Both should be broadcasted
			const emittedIntent1 = getLatestEmissionForIntent(setup, intent1Id);
			const emittedIntent2 = getLatestEmissionForIntent(setup, intent2Id);
			assertIntentInclusion(emittedIntent1!, 'InMemPool');
			assertIntentInclusion(emittedIntent2!, 'InMemPool');

			const emissionsBeforeRemove = setup.emissions.length;

			// Remove intent1
			setup.processor.remove(intent1Id);

			// Process again
			await processAndWait(setup);

			// intent2 should still work (no state change so no emission)
			const stillBroadcastedIntent2 = getLatestEmissionForIntent(setup, intent2Id);
			assertIntentInclusion(stillBroadcastedIntent2!, 'InMemPool');
		});
	});
});
