import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {
	createTestSetup,
	addSingleTxIntent,
	processAndWait,
	getLatestEmissionForIntent,
	type TestSetup,
} from '../helpers/scenarios.js';
import {resetHashCounter} from '../fixtures/transactions.js';
import {resetIntentIdCounter} from '../fixtures/intents.js';
import {createMockProvider} from '../mocks/MockEIP1193Provider.js';
import {createTransactionObserver} from '../../src/index.js';
import type {
	TransactionIntent,
	TransactionIntentEvent,
	BroadcastedTransaction,
} from '../../src/index.js';

describe('Edge Cases for Full Coverage', () => {
	let setup: TestSetup;

	beforeEach(() => {
		resetHashCounter();
		resetIntentIdCounter();
		setup = createTestSetup({finality: 12});
	});

	afterEach(() => {
		setup.cleanup();
	});

	describe('Finalized Block Returns Null', () => {
		it('should handle when latestFinalizedBlock returns null', async () => {
			const {provider, controller} = createMockProvider();
			const processor = createTransactionObserver({
				finality: 12,
				provider: provider as any,
			});

			// Create a custom provider that returns null for finalized block
			let callCount = 0;
			const customProvider = {
				async request(args: {method: string; params?: unknown[]}) {
					const result = await provider.request(args as any);
					// Return null for the finalized block request (second eth_getBlockByNumber call)
					if (args.method === 'eth_getBlockByNumber') {
						callCount++;
						if (callCount === 2) {
							return null;
						}
					}
					return result;
				},
			};

			processor.setProvider(customProvider as any);

			// Add an intent
			const intent: TransactionIntent = {
				transactions: [
					{
						hash: '0x1234567890123456789012345678901234567890123456789012345678901234',
						from: '0x1234567890123456789012345678901234567890',
						broadcastTimestamp: Date.now(),
					},
				],
			};
			processor.addMultiple({'test-intent': intent});

			// Process should return early when finalized block is null
			await processor.process();

			// Intent should remain unchanged
			expect(intent.state).toBeUndefined();
		});
	});

	describe('Already Finalized Transaction', () => {
		it('should skip processing when tx is already included and finalized', async () => {
			const {intentId, intent, addToMempool} = addSingleTxIntent(setup, {
				nonce: 5,
			});
			const txHash = intent.transactions[0].hash;

			// Get tx to broadcasted and included
			addToMempool();
			await processAndWait(setup);
			setup.controller.includeTx(txHash, 'success');
			await processAndWait(setup);

			// Advance to finality
			setup.controller.advanceBlocks(12);
			await processAndWait(setup);

			// Verify it's finalized via emissions
			const latestEmission = getLatestEmissionForIntent(setup, intentId);
			expect(latestEmission?.state?.final).toBeDefined();
			expect(latestEmission?.state?.inclusion).toBe('Included');

			const emissionCountBefore = setup.emissions.length;

			// Process again - should skip the tx since it's already final
			await processAndWait(setup);

			// No new emissions since nothing changed
			expect(setup.emissions.length).toBe(emissionCountBefore);
		});
	});

	describe('Transaction Appears on Retry Fetch', () => {
		it('should handle when tx is not found on first fetch but found on retry', async () => {
			const {provider, controller} = createMockProvider();
			const processor = createTransactionObserver({
				finality: 12,
				provider: provider as any,
			});

			const emissions: TransactionIntent[] = [];
			processor.on('intent:updated', (event) => {
				emissions.push({
					...event.intent,
					transactions: [...event.intent.transactions],
				});
				return () => {};
			});

			const txHash =
				'0xabcdef1234567890123456789012345678901234567890123456789012345678' as const;

			// Add tx to mempool
			controller.addToMempool({
				hash: txHash,
				from: '0x1111111111111111111111111111111111111111',
				nonce: 5,
				maxFeePerGas: '0x1',
				maxPriorityFeePerGas: '0x1',
			});

			const intent: TransactionIntent = {
				transactions: [
					{
						hash: txHash,
						from: '0x1111111111111111111111111111111111111111',
						nonce: 5,
						broadcastTimestamp: Date.now(),
					},
				],
			};
			processor.addMultiple({'test-intent-retry': intent});

			// First process should find it in mempool
			await processor.process();
			const latestEmission = emissions[emissions.length - 1];
			expect(latestEmission?.state?.inclusion).toBe('InMemPool');

			// Now create a scenario where first fetch returns null but second returns the tx
			let fetchCallCount = 0;
			const trickyProvider = {
				async request(args: {method: string; params?: unknown[]}) {
					if (args.method === 'eth_getTransactionByHash') {
						fetchCallCount++;
						// First call returns null, second returns the tx
						if (fetchCallCount === 1) {
							return null;
						}
						// Second call (retry) returns the tx
						return await provider.request(args as any);
					}
					return await provider.request(args as any);
				},
			};

			processor.setProvider(trickyProvider as any);

			// Process again - first fetch returns null, retry finds it
			// This should hit line 484 and return false (skip for now)
			await processor.process();

			// Transaction should still be InMemPool since retry found it
			const finalEmission = emissions[emissions.length - 1];
			expect(finalEmission?.state?.inclusion).toBe('InMemPool');
		});
	});

	describe('Listener Removal', () => {
		it('should properly remove intent listener with offOperation', () => {
			const {processor} = setup;
			let callCount = 0;

			const listener = (_event: TransactionIntentEvent) => {
				callCount++;
				return () => {};
			};

			// Add listener
			processor.on('intent:updated', listener);

			// Remove listener using offOperation
			processor.off('intent:updated', listener);

			// Listener should be removed (no way to verify directly without emitting)
			// This test just ensures the method exists and doesn't throw
			expect(() => processor.off('intent:updated', listener)).not.toThrow();
		});

		it('should properly remove intentStatus listener with offOperationStatus', () => {
			const {processor} = setup;
			let callCount = 0;

			const listener = (_event: TransactionIntentEvent) => {
				callCount++;
				return () => {};
			};

			// Add listener
			processor.on('intent:status', listener);

			// Remove listener using offOperationStatus
			processor.off('intent:status', listener);

			// Listener should be removed
			expect(() => processor.off('intent:status', listener)).not.toThrow();
		});

		it('should not emit to removed intent listener', async () => {
			const {intent, addToMempool} = addSingleTxIntent(setup, {nonce: 5});

			let callCount = 0;
			const listener = (_event: TransactionIntentEvent) => {
				callCount++;
				return () => {};
			};

			// Add and then remove listener
			setup.processor.on('intent:updated', listener);
			setup.processor.off('intent:updated', listener);

			// Trigger emission
			addToMempool();
			await processAndWait(setup);

			// Listener should not have been called since we removed it
			// But our test setup also has a listener, so we're just checking our custom one
			expect(callCount).toBe(0);
		});

		it('should not emit to removed intentStatus listener', async () => {
			const {intent, addToMempool} = addSingleTxIntent(setup, {nonce: 5});

			let callCount = 0;
			const listener = (_event: TransactionIntentEvent) => {
				callCount++;
				return () => {};
			};

			// Add and then remove listener
			setup.processor.on('intent:status', listener);
			setup.processor.off('intent:status', listener);

			// Trigger emission
			addToMempool();
			await processAndWait(setup);

			// Listener should not have been called
			expect(callCount).toBe(0);
		});
	});

	describe('Provider Undefined During Processing', () => {
		it('should handle provider being undefined during processTx', async () => {
			const {processor} = createTestSetup({finality: 12});

			const intent: TransactionIntent = {
				transactions: [
					{
						hash: '0x1234567890123456789012345678901234567890123456789012345678901234',
						from: '0x1234567890123456789012345678901234567890',
						broadcastTimestamp: Date.now(),
					},
				],
			};
			processor.addMultiple({'test-no-provider': intent});

			// Set provider to undefined
			processor.setProvider(undefined as any);

			// Process should return early
			await processor.process();

			// Intent should remain unchanged
			expect(intent.state).toBeUndefined();
		});
	});

	describe('Intent Status Events vs Intent Events', () => {
		it('should emit intent:status event when status changes', async () => {
			const {intent, addToMempool} = addSingleTxIntent(setup, {nonce: 5});

			let statusEventCount = 0;
			const statusListener = (_event: TransactionIntentEvent) => {
				statusEventCount++;
				return () => {};
			};

			setup.processor.on('intent:status', statusListener);

			// Process - should emit status event for initial state change
			addToMempool();
			await processAndWait(setup);

			expect(statusEventCount).toBeGreaterThan(0);
		});
	});

	describe('Latest Block Returns Null', () => {
		it('should handle when latestBlock returns null', async () => {
			const {provider, controller} = createMockProvider();
			const processor = createTransactionObserver({
				finality: 12,
				provider: provider as any,
			});

			// Create a custom provider that returns null for latest block
			const customProvider = {
				async request(args: {method: string; params?: unknown[]}) {
					// Return null for the latest block request
					if (
						args.method === 'eth_getBlockByNumber' &&
						args.params?.[0] === 'latest'
					) {
						return null;
					}
					return await provider.request(args as any);
				},
			};

			processor.setProvider(customProvider as any);

			// Add an intent
			const intent: TransactionIntent = {
				transactions: [
					{
						hash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
						from: '0x1234567890123456789012345678901234567890',
						broadcastTimestamp: Date.now(),
					},
				],
			};
			processor.addMultiple({'test-intent-null-latest': intent});

			// Process should return early when latest block is null
			await processor.process();

			// Intent should remain unchanged
			expect(intent.state).toBeUndefined();
		});
	});

	describe('BeingFetched Status in computeIntentStatus', () => {
		it('should return BeingFetched when some txs are BeingFetched and none are Broadcasted/Included', async () => {
			const {provider, controller} = createMockProvider();
			const processor = createTransactionObserver({
				finality: 12,
				provider: provider as any,
			});

			const emissions: TransactionIntent[] = [];
			processor.on('intent:updated', (event) => {
				emissions.push({
					...event.intent,
					transactions: [...event.intent.transactions],
				});
				return () => {};
			});

			// Create an intent with two txs: both without state (BeingFetched)
			const intent: TransactionIntent = {
				transactions: [
					{
						hash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
						from: '0x1234567890123456789012345678901234567890',
						broadcastTimestamp: Date.now(),
					},
					{
						hash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
						from: '0x1234567890123456789012345678901234567890',
						broadcastTimestamp: Date.now(),
					},
				],
			};
			processor.addMultiple({'test-intent-being-fetched': intent});

			// Create a provider where:
			// - First tx returns null on both fetches -> NotFound
			// - Second tx returns null on first fetch, then found on retry -> skipped (no change)
			let tx2CallCount = 0;
			const customProvider = {
				async request(args: {method: string; params?: unknown[]}) {
					if (args.method === 'eth_getTransactionByHash') {
						const hash = args.params?.[0] as string;
						// First tx - not found (both fetches return null)
						if (
							hash ===
							'0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
						) {
							return null;
						}
						// Second tx - simulate slow/missing response by returning null on first fetch only
						// to keep it in BeingFetched state
						if (
							hash ===
							'0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
						) {
							tx2CallCount++;
							if (tx2CallCount === 1) {
								return null;
							}
							// Retry returns the tx (this triggers the skip logic for line 484)
							controller.addToMempool({
								hash: hash as `0x${string}`,
								from: '0x1234567890123456789012345678901234567890',
								nonce: 0,
								maxFeePerGas: '0x1',
								maxPriorityFeePerGas: '0x1',
							});
							return await provider.request(args as any);
						}
					}
					return await provider.request(args as any);
				},
			};

			processor.setProvider(customProvider as any);

			// Process - second tx should trigger line 484 (retry returns tx, skip for now)
			await processor.process();

			// The intent should emit since at least tx1 changed state (BeingFetched -> NotFound)
			// First tx went to NotFound, second tx was skipped (still BeingFetched effectively)
			const latestEmission = emissions[emissions.length - 1];
			expect(latestEmission).toBeDefined();
			expect(latestEmission?.transactions[0].state?.inclusion).toBe('NotFound');
		});
	});
});
