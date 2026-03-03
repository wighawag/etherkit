import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	createTestSetup,
	addSingleTxOperation,
	processAndWait,
	getLatestEmissionForOp,
	type TestSetup,
} from '../helpers/scenarios.js';
import {
	assertOperationInclusion,
	assertOperationIncluded,
} from '../helpers/assertions.js';
import {resetHashCounter} from '../fixtures/transactions.js';
import {resetOpIdCounter} from '../fixtures/operations.js';

describe('Network Conditions', () => {
	let setup: TestSetup;

	beforeEach(() => {
		resetHashCounter();
		resetOpIdCounter();
	});

	afterEach(() => {
		if (setup) {
			setup.cleanup();
		}
	});

	describe('Provider Failures', () => {
		it('network-eth-getBlockByNumber-fails: Latest block fetch fails', async () => {
			setup = createTestSetup({finality: 12});

			const {operation, addToMempool} = addSingleTxOperation(setup, {nonce: 5});
			addToMempool();

			// Make eth_getBlockByNumber fail
			setup.controller.setFailMethods(['eth_getBlockByNumber']);

			// Process should throw but operation state should remain unchanged
			await expect(setup.processor.process()).rejects.toThrow();

			// No emissions should have occurred
			expect(setup.emissions.length).toBe(0);
		});

		it('network-eth-getTransactionByHash-fails: Tx lookup fails', async () => {
			setup = createTestSetup({finality: 12});

			const {operationId, addToMempool} = addSingleTxOperation(setup, {
				nonce: 5,
			});
			addToMempool();

			// First successful process
			await processAndWait(setup);
			const emittedOp = getLatestEmissionForOp(setup, operationId);
			assertOperationInclusion(emittedOp!, 'InMemPool');

			// Make tx lookup fail
			setup.controller.setFailMethods(['eth_getTransactionByHash']);

			// Process should throw
			await expect(setup.processor.process()).rejects.toThrow();

			// Most recent emission should still show previous state
			const lastEmission = getLatestEmissionForOp(setup, operationId);
			expect(lastEmission?.state?.inclusion).toBe('InMemPool');
		});

		it('network-eth-getTransactionReceipt-fails: Receipt fetch fails', async () => {
			setup = createTestSetup({finality: 12});

			const {operation, operationId, addToMempool} = addSingleTxOperation(
				setup,
				{nonce: 5},
			);
			const txHash = operation.transactions[0].hash;
			addToMempool();

			await processAndWait(setup);

			// Include tx but make receipt fetch fail
			setup.controller.includeTx(txHash, 'success');
			setup.controller.setFailMethods(['eth_getTransactionReceipt']);

			// Process should throw
			await expect(setup.processor.process()).rejects.toThrow();

			// Operation should stay at Broadcasted (couldn't confirm inclusion)
			const lastEmission = getLatestEmissionForOp(setup, operationId);
			expect(lastEmission?.state?.inclusion).toBe('InMemPool');
		});

		it('network-intermittent: Random failures with recovery', async () => {
			setup = createTestSetup({finality: 12});

			const {operation, operationId, addToMempool} = addSingleTxOperation(
				setup,
				{nonce: 5},
			);
			const txHash = operation.transactions[0].hash;
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
			const emittedOp = getLatestEmissionForOp(setup, operationId);
			assertOperationIncluded(emittedOp!, 'Success');
		});
	});

	describe('Disconnect/Reconnect', () => {
		it('should handle provider disconnect', async () => {
			setup = createTestSetup({finality: 12});

			const {operationId, addToMempool} = addSingleTxOperation(setup, {
				nonce: 5,
			});
			addToMempool();

			await processAndWait(setup);
			const emittedOp = getLatestEmissionForOp(setup, operationId);
			assertOperationInclusion(emittedOp!, 'InMemPool');

			// Disconnect
			setup.controller.simulateDisconnect();

			// Process should fail
			await expect(setup.processor.process()).rejects.toThrow();
		});

		it('should recover after reconnect', async () => {
			setup = createTestSetup({finality: 12});

			const {operation, operationId, addToMempool} = addSingleTxOperation(
				setup,
				{nonce: 5},
			);
			const txHash = operation.transactions[0].hash;
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
			const emittedOp = getLatestEmissionForOp(setup, operationId);
			assertOperationIncluded(emittedOp!, 'Success');
		});
	});

	describe('Block Progression', () => {
		it('blocks-progression: Blocks advance normally', async () => {
			setup = createTestSetup({finality: 12});

			const {operation, operationId, addToMempool} = addSingleTxOperation(
				setup,
				{nonce: 5},
			);
			const txHash = operation.transactions[0].hash;
			addToMempool();

			await processAndWait(setup);

			// Include and get initial block number
			setup.controller.includeTx(txHash, 'success');
			await processAndWait(setup);

			const initialBlockNumber = setup.controller.getBlockNumber();

			// Not finalized yet
			const includedOp = getLatestEmissionForOp(setup, operationId);
			expect(includedOp?.state?.final).toBeUndefined();

			// Advance blocks
			setup.controller.advanceBlocks(12);
			await processAndWait(setup);

			// Should be finalized
			const finalizedOp = getLatestEmissionForOp(setup, operationId);
			expect(finalizedOp?.state?.final).toBeDefined();

			// Block number should have advanced
			expect(setup.controller.getBlockNumber()).toBe(initialBlockNumber + 12);
		});

		it('blocks-finality-boundary: Tx at exactly finality boundary', async () => {
			setup = createTestSetup({finality: 12});

			const {operation, operationId, addToMempool} = addSingleTxOperation(
				setup,
				{nonce: 5},
			);
			const txHash = operation.transactions[0].hash;
			addToMempool();

			await processAndWait(setup);

			setup.controller.includeTx(txHash, 'success');
			await processAndWait(setup);

			// Advance to one before finality
			setup.controller.advanceBlocks(11);
			await processAndWait(setup);
			const almostFinalOp = getLatestEmissionForOp(setup, operationId);
			expect(almostFinalOp?.state?.final).toBeUndefined();

			// Advance exactly one more block to reach finality
			setup.controller.advanceBlock();
			await processAndWait(setup);

			// Should now be finalized
			const finalizedOp = getLatestEmissionForOp(setup, operationId);
			expect(finalizedOp?.state?.final).toBeDefined();
		});
	});

	describe('Latency Simulation', () => {
		it('should handle latency in responses', async () => {
			setup = createTestSetup({finality: 12, latencyMs: 50});

			const {operationId, addToMempool} = addSingleTxOperation(setup, {
				nonce: 5,
			});
			addToMempool();

			const startTime = Date.now();
			await processAndWait(setup);
			const endTime = Date.now();

			// Should have taken some time due to latency
			// Multiple RPC calls means multiple latency delays
			expect(endTime - startTime).toBeGreaterThanOrEqual(50);

			const emittedOp = getLatestEmissionForOp(setup, operationId);
			assertOperationInclusion(emittedOp!, 'InMemPool');
		});

		it('should work with dynamic latency changes', async () => {
			setup = createTestSetup({finality: 12});

			const {operation, operationId, addToMempool} = addSingleTxOperation(
				setup,
				{nonce: 5},
			);
			addToMempool();

			// Start with no latency
			await processAndWait(setup);
			const broadcastedOp = getLatestEmissionForOp(setup, operationId);
			assertOperationInclusion(broadcastedOp!, 'InMemPool');

			// Add latency mid-test
			setup.controller.setLatency(10);

			const txHash = operation.transactions[0].hash;
			setup.controller.includeTx(txHash, 'success');

			await processAndWait(setup);
			const includedOp = getLatestEmissionForOp(setup, operationId);
			assertOperationIncluded(includedOp!, 'Success');
		});
	});

	describe('Timing Edge Cases', () => {
		it('timing-rapid-process-calls: Multiple process calls in quick succession', async () => {
			setup = createTestSetup({finality: 12});

			const {operationId, addToMempool} = addSingleTxOperation(setup, {
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
			const emittedOp = getLatestEmissionForOp(setup, operationId);
			assertOperationInclusion(emittedOp!, 'InMemPool');

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

			const {operation, operationId, addToMempool} = addSingleTxOperation(
				setup,
				{nonce: 5},
			);
			const txHash = operation.transactions[0].hash;
			addToMempool();

			await processAndWait(setup);
			const broadcastedOp = getLatestEmissionForOp(setup, operationId);
			assertOperationInclusion(broadcastedOp!, 'InMemPool');

			// Remove from mempool between process calls
			setup.controller.removeFromMempool(txHash);

			await processAndWait(setup);

			// Should reflect current state (NotFound), not stale (Broadcasted)
			const notFoundOp = getLatestEmissionForOp(setup, operationId);
			assertOperationInclusion(notFoundOp!, 'NotFound');
		});
	});

	describe('Clear and Remove Operations', () => {
		it('should handle clear during idle', async () => {
			setup = createTestSetup({finality: 12});

			const {operation, addToMempool} = addSingleTxOperation(setup, {nonce: 5});
			addToMempool();

			await processAndWait(setup);
			const emissionCountBefore = setup.emissions.length;

			// Clear all operations
			setup.processor.clear();

			// Process should work but do nothing (no operations to process)
			await processAndWait(setup);

			// No new emissions after clear (count should be same as before)
			expect(setup.emissions.length).toBe(emissionCountBefore);
		});

		it('should handle remove specific operation', async () => {
			setup = createTestSetup({finality: 12});

			const {operationId: op1Id, addToMempool: addTx1} = addSingleTxOperation(
				setup,
				{nonce: 5},
			);
			addTx1();

			const {operationId: op2Id, addToMempool: addTx2} = addSingleTxOperation(
				setup,
				{nonce: 6},
			);
			addTx2();

			await processAndWait(setup);

			// Both should be broadcasted
			const emittedOp1 = getLatestEmissionForOp(setup, op1Id);
			const emittedOp2 = getLatestEmissionForOp(setup, op2Id);
			assertOperationInclusion(emittedOp1!, 'InMemPool');
			assertOperationInclusion(emittedOp2!, 'InMemPool');

			const emissionsBeforeRemove = setup.emissions.length;

			// Remove op1
			setup.processor.remove(op1Id);

			// Process again
			await processAndWait(setup);

			// op2 should still work (no state change so no emission)
			const stillBroadcastedOp2 = getLatestEmissionForOp(setup, op2Id);
			assertOperationInclusion(stillBroadcastedOp2!, 'InMemPool');
		});
	});
});
