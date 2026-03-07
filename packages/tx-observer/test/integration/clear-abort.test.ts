import {describe, it, expect, beforeEach} from 'vitest';
import {createTransactionObserver, TransactionIntentEvent} from '../../src';
import {
	createMockProvider,
	type MockProviderController,
} from '../mocks/MockEIP1193Provider';
import {createBroadcastedTx, createMockTx} from '../fixtures/transactions';
import {createIntent} from '../fixtures/intents';

describe('Clear Abort', () => {
	let controller: MockProviderController;
	let observer: ReturnType<typeof createTransactionObserver>;
	let statusEvents: TransactionIntentEvent[];
	let updatedEvents: TransactionIntentEvent[];

	const accountA = '0xaaaa000000000000000000000000000000000001' as const;
	const accountB = '0xbbbb000000000000000000000000000000000002' as const;
	const txHashA =
		'0xa000000000000000000000000000000000000000000000000000000000000001' as const;
	const txHashB =
		'0xb000000000000000000000000000000000000000000000000000000000000001' as const;

	beforeEach(() => {
		const {provider, controller: ctrl} = createMockProvider({
			initialBlockNumber: 100,
			latencyMs: 0,
		});
		controller = ctrl;

		observer = createTransactionObserver({
			finality: 12,
			provider,
		});

		statusEvents = [];
		updatedEvents = [];

		observer.on('intent:status', (event) => {
			statusEvents.push(event);
		});
		observer.on('intent:updated', (event) => {
			updatedEvents.push(event);
		});
	});

	describe('clear() during processing', () => {
		it('should abort processing when clear() is called during block fetch', async () => {
			// Add intent for Account A
			const txA = createBroadcastedTx({
				hash: txHashA,
				from: accountA,
				nonce: 0,
			});
			const intentA = createIntent({transactions: [txA]});
			observer.add('intent-1', intentA);

			// Add tx to mempool
			controller.addToMempool(
				createMockTx({
					hash: txHashA,
					from: accountA,
					nonce: 0,
				}),
			);

			// Set up a delay and clear during the delay
			controller.setLatency(50);

			// Start processing
			const processPromise = observer.process();

			// Clear while waiting for block fetch
			await new Promise((resolve) => setTimeout(resolve, 25));
			observer.clear();

			// Add a new intent for Account B
			const txB = createBroadcastedTx({
				hash: txHashB,
				from: accountB,
				nonce: 0,
			});
			const intentB = createIntent({transactions: [txB]});
			observer.add('intent-1', intentB);

			await processPromise;

			// Verify no status events were emitted for Account A
			for (const event of statusEvents) {
				expect(event.intent.transactions[0].from).not.toBe(accountA);
			}
		});

		it('should not emit events for cleared intents', async () => {
			// Add intent for Account A
			const txA = createBroadcastedTx({
				hash: txHashA,
				from: accountA,
				nonce: 0,
			});
			const intentA = createIntent({transactions: [txA]});
			observer.add('intent-1', intentA);

			// Add tx to mempool
			controller.addToMempool(
				createMockTx({
					hash: txHashA,
					from: accountA,
					nonce: 0,
				}),
			);

			// Set up hook to clear midway through processing
			let requestCount = 0;
			const unhook = controller.onRequest(async () => {
				requestCount++;
				if (requestCount === 2) {
					// Clear after first RPC call in processAttempt
					observer.clear();
				}
			});

			await observer.process();
			unhook();

			// Should have no status events since we cleared before emission
			expect(statusEvents.length).toBe(0);
		});

		it('should abort processing for multiple intents when clear() is called', async () => {
			// Add multiple intents for Account A
			const tx1 = createBroadcastedTx({
				hash: txHashA,
				from: accountA,
				nonce: 0,
			});
			const tx2Hash =
				'0xa000000000000000000000000000000000000000000000000000000000000002' as `0x${string}`;
			const tx2 = createBroadcastedTx({
				hash: tx2Hash,
				from: accountA,
				nonce: 1,
			});
			observer.add('intent-1', createIntent({transactions: [tx1]}));
			observer.add('intent-2', createIntent({transactions: [tx2]}));

			// Add txs to mempool
			controller.addToMempool(
				createMockTx({
					hash: txHashA,
					from: accountA,
					nonce: 0,
				}),
			);
			controller.addToMempool(
				createMockTx({
					hash: tx2Hash,
					from: accountA,
					nonce: 1,
				}),
			);

			// Set up hook to clear after processing first intent
			let processedIntents = 0;
			const unhook = controller.onRequest(async (method) => {
				if (method === 'eth_getTransactionByHash') {
					processedIntents++;
					if (processedIntents === 2) {
						// Clear after first intent's transactions are processed
						observer.clear();
					}
				}
			});

			await observer.process();
			unhook();

			// Should not have processed intent-2 due to clear
			const intent2Events = statusEvents.filter((e) => e.id === 'intent-2');
			expect(intent2Events.length).toBe(0);
		});

		it('should allow new intents to process after clear()', async () => {
			// Add intent for Account A
			const txA = createBroadcastedTx({
				hash: txHashA,
				from: accountA,
				nonce: 0,
			});
			observer.add('intent-1', createIntent({transactions: [txA]}));

			// Clear and add Account B's intent
			observer.clear();

			const txB = createBroadcastedTx({
				hash: txHashB,
				from: accountB,
				nonce: 0,
			});
			observer.add('intent-1', createIntent({transactions: [txB]}));

			// Add tx to mempool for Account B
			controller.addToMempool(
				createMockTx({
					hash: txHashB,
					from: accountB,
					nonce: 0,
				}),
			);

			await observer.process();

			// Should have events only for Account B
			expect(statusEvents.length).toBeGreaterThan(0);
			for (const event of statusEvents) {
				expect(event.intent.transactions[0].from).toBe(accountB);
			}
		});

		it('should handle same intent ID for different accounts after clear', async () => {
			// This tests the scenario where the same ID is used for different accounts
			const sharedId = 'shared-intent-id';

			// Add intent for Account A
			const txA = createBroadcastedTx({
				hash: txHashA,
				from: accountA,
				nonce: 0,
			});
			observer.add(sharedId, createIntent({transactions: [txA]}));

			controller.addToMempool(
				createMockTx({
					hash: txHashA,
					from: accountA,
					nonce: 0,
				}),
			);

			// Start processing with delay
			controller.setLatency(30);
			const processPromise = observer.process();

			// Switch to Account B immediately
			await new Promise((resolve) => setTimeout(resolve, 10));
			observer.clear();

			// Add Account B's intent with the same ID
			const txB = createBroadcastedTx({
				hash: txHashB,
				from: accountB,
				nonce: 0,
			});
			observer.add(sharedId, createIntent({transactions: [txB]}));

			controller.addToMempool(
				createMockTx({
					hash: txHashB,
					from: accountB,
					nonce: 0,
				}),
			);

			await processPromise;

			// All emitted events should be for Account B (or no events at all is also acceptable)
			for (const event of statusEvents) {
				if (event.id === sharedId) {
					expect(event.intent.transactions[0].from).toBe(accountB);
				}
			}
		});
	});

	describe('clear generation counter', () => {
		it('should emit intents:cleared event on clear()', async () => {
			let clearedCount = 0;
			observer.on('intents:cleared', () => {
				clearedCount++;
			});

			observer.clear();
			expect(clearedCount).toBe(1);

			observer.clear();
			expect(clearedCount).toBe(2);
		});

		it('should not affect processing that starts after clear()', async () => {
			const txA = createBroadcastedTx({
				hash: txHashA,
				from: accountA,
				nonce: 0,
			});
			observer.add('intent-1', createIntent({transactions: [txA]}));

			// Clear before processing
			observer.clear();

			// Add new intent
			const txB = createBroadcastedTx({
				hash: txHashB,
				from: accountB,
				nonce: 0,
			});
			observer.add('intent-1', createIntent({transactions: [txB]}));

			controller.addToMempool(
				createMockTx({
					hash: txHashB,
					from: accountB,
					nonce: 0,
				}),
			);

			// Process - this should work normally for Account B
			await observer.process();

			// Should have events for Account B
			expect(statusEvents.length).toBeGreaterThan(0);
			expect(statusEvents[0].intent.transactions[0].from).toBe(accountB);
		});
	});
});
