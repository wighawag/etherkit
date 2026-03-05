import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	createTestSetup,
	addSingleTxIntent,
	processAndWait,
	runBasicLifecycleScenario,
	getLatestEmissionForIntent,
	type TestSetup,
} from '../helpers/scenarios.js';
import {
	assertIntentInclusion,
	assertIntentIncluded,
	assertIntentFinalized,
	assertEmissionSequence,
} from '../helpers/assertions.js';
import {resetHashCounter} from '../fixtures/transactions.js';
import {resetIntentIdCounter} from '../fixtures/intents.js';

describe('Single Transaction Lifecycle', () => {
	let setup: TestSetup;

	beforeEach(() => {
		resetHashCounter();
		resetIntentIdCounter();
		setup = createTestSetup({finality: 12});
	});

	afterEach(() => {
		setup.cleanup();
	});

	describe('Basic Lifecycle States', () => {
		it('should transition from BeingFetched to Broadcasted when tx appears in mempool', async () => {
			const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce: 5,
			});

			// Initial state
			expect(intent.state).toBeUndefined();

			// Process before adding to mempool - should be NotFound
			await processAndWait(setup);
			const notFoundIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(notFoundIntent!, 'NotFound');

			// Add to mempool and process
			addToMempool();
			await processAndWait(setup);

			const broadcastedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(broadcastedIntent!, 'InMemPool');
		});

		it('should transition from Broadcasted to Included when tx is mined', async () => {
			const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			const txHash = intent.transactions[0].hash;

			addToMempool();
			await processAndWait(setup);
			const broadcastedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(broadcastedIntent!, 'InMemPool');

			// Include the tx
			setup.controller.includeTx(txHash, 'success');
			await processAndWait(setup);

			const includedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentIncluded(includedIntent!, 'Success');
		});

		it('should set final timestamp when tx reaches finality', async () => {
			const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			const txHash = intent.transactions[0].hash;

			addToMempool();
			await processAndWait(setup);

			// Include the tx
			setup.controller.includeTx(txHash, 'success');
			await processAndWait(setup);

			// Not finalized yet
			const includedIntent = getLatestEmissionForIntent(setup, intentId);
			expect(includedIntent?.state?.final).toBeUndefined();

			// Advance blocks to finality
			setup.controller.advanceBlocks(12);
			await processAndWait(setup);

			// Should now be finalized
			const finalizedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentFinalized(finalizedIntent!);
		});

		it('should handle failed transaction correctly', async () => {
			const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			const txHash = intent.transactions[0].hash;

			addToMempool();
			await processAndWait(setup);

			// Include as failure
			setup.controller.includeTx(txHash, 'failure');
			await processAndWait(setup);

			const failedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentIncluded(failedIntent!, 'Failure');
		});

		it('should complete full lifecycle: BeingFetched → Broadcasted → Included → Final', async () => {
			const {phases} = await runBasicLifecycleScenario(setup, 5);

			// Verify each phase
			expect(phases.added?.state?.inclusion).toBe('NotFound'); // Not in mempool yet
			expect(phases.broadcasted?.state?.inclusion).toBe('InMemPool');
			expect(phases.included?.state?.inclusion).toBe('Included');
			expect(phases.finalized?.state?.final).toBeDefined();
		});
	});

	describe('Event Emissions', () => {
		it('should emit intent event on each status change', async () => {
			const {intent, addToMempool} = addSingleTxIntent(setup, {nonce: 5});
			const txHash = intent.transactions[0].hash;

			// Process to get NotFound
			await processAndWait(setup);
			expect(setup.emissions.length).toBeGreaterThan(0);
			const notFoundEmission = setup.emissions[setup.emissions.length - 1];
			expect(notFoundEmission.state?.inclusion).toBe('NotFound');

			// Broadcasted
			addToMempool();
			await processAndWait(setup);
			const broadcastedEmission = setup.emissions[setup.emissions.length - 1];
			expect(broadcastedEmission.state?.inclusion).toBe('InMemPool');

			// Included
			setup.controller.includeTx(txHash, 'success');
			await processAndWait(setup);
			const includedEmission = setup.emissions[setup.emissions.length - 1];
			expect(includedEmission.state?.inclusion).toBe('Included');

			// Finalized
			setup.controller.advanceBlocks(12);
			await processAndWait(setup);
			const finalizedEmission = setup.emissions[setup.emissions.length - 1];
			expect(finalizedEmission.state?.final).toBeDefined();
		});

		it('should not emit duplicate events for unchanged status', async () => {
			const {intent, addToMempool} = addSingleTxIntent(setup, {nonce: 5});

			addToMempool();
			await processAndWait(setup);
			const emissionCount1 = setup.emissions.length;

			// Process again without any changes
			await processAndWait(setup);
			const emissionCount2 = setup.emissions.length;

			// Should not have emitted a new event
			expect(emissionCount2).toBe(emissionCount1);
		});

		it('should emit events with correct intent data', async () => {
			const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			const txHash = intent.transactions[0].hash;

			addToMempool();
			await processAndWait(setup);

			const emissionEvent =
				setup.emissionEvents[setup.emissionEvents.length - 1];

			// Verify emission contains correct data
			expect(emissionEvent.id).toBe(intentId);
			expect(emissionEvent.intent.transactions).toHaveLength(1);
			expect(emissionEvent.intent.transactions[0].hash).toBe(txHash);
			expect(emissionEvent.intent.state?.inclusion).toBe('InMemPool');
		});
	});

	describe('Mempool Visibility', () => {
		it('should detect tx immediately when added to mempool', async () => {
			const {intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce: 5,
			});

			// Add to mempool before first process
			addToMempool();
			await processAndWait(setup);

			// Should go directly to Broadcasted, not through NotFound
			const emittedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(emittedIntent!, 'InMemPool');
		});

		it('should handle delayed mempool visibility', async () => {
			const {intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce: 5,
			});

			// Process without tx in mempool
			await processAndWait(setup);
			const notFoundIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(notFoundIntent!, 'NotFound');

			// Tx appears in mempool later
			addToMempool();
			await processAndWait(setup);

			const broadcastedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentInclusion(broadcastedIntent!, 'InMemPool');
		});
	});

	describe('Transaction Nonce Handling', () => {
		it('should track nonce from mempool tx', async () => {
			const expectedNonce = 42;
			const {intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce: expectedNonce,
			});

			addToMempool();
			await processAndWait(setup);

			// Nonce should be set from the mempool response (in emitted intent)
			const emittedIntent = getLatestEmissionForIntent(setup, intentId);
			expect(emittedIntent?.transactions[0].nonce).toBe(expectedNonce);
		});

		it('should handle tx without initial nonce', async () => {
			const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce: undefined,
			});

			// Before processing, nonce might be undefined
			expect(intent.transactions[0].nonce).toBeUndefined();

			addToMempool();
			await processAndWait(setup);

			// After processing, nonce should be set (defaulted to 0 in mock) in emitted intent
			const emittedIntent = getLatestEmissionForIntent(setup, intentId);
			expect(typeof emittedIntent?.transactions[0].nonce).toBe('number');
		});
	});

	describe('Block Confirmation', () => {
		it('should not finalize tx before reaching finality threshold', async () => {
			const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			const txHash = intent.transactions[0].hash;

			addToMempool();
			await processAndWait(setup);

			setup.controller.includeTx(txHash, 'success');
			await processAndWait(setup);

			// Advance only 5 blocks (less than finality of 12)
			setup.controller.advanceBlocks(5);
			await processAndWait(setup);

			// Should still not be finalized
			const emittedIntent = getLatestEmissionForIntent(setup, intentId);
			expect(emittedIntent?.state?.final).toBeUndefined();
		});

		it('should finalize tx exactly at finality threshold', async () => {
			const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			const txHash = intent.transactions[0].hash;

			addToMempool();
			await processAndWait(setup);

			setup.controller.includeTx(txHash, 'success');
			await processAndWait(setup);

			// Advance exactly to finality threshold
			setup.controller.advanceBlocks(12);
			await processAndWait(setup);

			const finalizedIntent = getLatestEmissionForIntent(setup, intentId);
			assertIntentFinalized(finalizedIntent!);
		});
	});

	describe('Without Provider', () => {
		it('should handle missing provider gracefully', async () => {
			const {processor} = createTestSetup();

			// Clear the provider
			processor.setProvider(undefined as any);

			// This should not throw
			await processor.process();
		});
	});
});
