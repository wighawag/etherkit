/**
 * Tests for the dual-event system:
 * - 'intent' event: fires when any TX in the intent changes (for persistence)
 * - 'intent:status' event: fires only when intent status changes (for UI/state)
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	initTransactionProcessor,
	type TransactionIntent,
	type TransactionIntentEvent,
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
import {createIntent, resetIntentIdCounter} from '../fixtures/intents.js';

describe('Event Types', () => {
	let processor: ReturnType<typeof initTransactionProcessor>;
	let controller: MockProviderController;
	let intentEmissions: TransactionIntent[];
	let intentEvents: TransactionIntentEvent[];
	let statusEmissions: TransactionIntent[];
	let cleanupIntent: () => void;
	let cleanupStatus: () => void;

	beforeEach(() => {
		resetHashCounter();
		resetIntentIdCounter();

		const {provider, controller: ctrl} = createMockProvider();
		controller = ctrl;

		processor = initTransactionProcessor({
			finality: 12,
			provider,
		});

		intentEmissions = [];
		intentEvents = [];
		statusEmissions = [];

		// Listen to both event types
		cleanupIntent = processor.onOperationUpdated((event) => {
			intentEmissions.push(structuredClone(event.intent));
			intentEvents.push(structuredClone(event));
			return () => {};
		});

		cleanupStatus = processor.onOperationStatusUpdated((event) => {
			statusEmissions.push(structuredClone(event.intent));
			return () => {};
		});
	});

	afterEach(() => {
		cleanupIntent();
		cleanupStatus();
	});

	// Helper to get latest emission for an intent ID
	function getLatestEmission(intentId: string): TransactionIntent | undefined {
		for (let i = intentEvents.length - 1; i >= 0; i--) {
			if (intentEvents[i].id === intentId) {
				return intentEvents[i].intent;
			}
		}
		return undefined;
	}

	describe('intent vs intent:status events', () => {
		it('should emit both events when intent status changes', async () => {
			const tx1 = createBroadcastedTx({nonce: 5});
			const mockTx1 = createMockTx({
				hash: tx1.hash,
				from: tx1.from,
				nonce: 5,
			});
			const intent = createIntent({transactions: [tx1]});

			controller.addToMempool(mockTx1);
			processor.addMultiple({'dual-emit': intent});

			// First process: BeingFetched -> Broadcasted (status change)
			await processor.process();

			// Both events should fire for initial status change
			expect(intentEmissions.length).toBe(1);
			expect(statusEmissions.length).toBe(1);

			expect(intentEmissions[0].state?.inclusion).toBe('InMemPool');
			expect(statusEmissions[0].state?.inclusion).toBe('InMemPool');
		});

		it('should emit intent but NOT intent:status when only TX changes without status change', async () => {
			/**
			 * Scenario:
			 * - Intent has TX1 (Broadcasted) and TX2 (Broadcasted)
			 * - TX1 becomes Included (Success)
			 * - TX2 also becomes Included (Success)
			 *
			 * After TX1 inclusion:
			 * - Intent status: Included (changed)
			 * - Both events fire
			 *
			 * After TX2 inclusion:
			 * - Intent status: still Included (no change)
			 * - Only 'intent' event fires (TX2 changed)
			 * - 'intent:status' does NOT fire (status unchanged)
			 */

			const tx1 = createBroadcastedTx({nonce: 5});
			const tx2 = createBroadcastedTx({nonce: 6, from: TEST_ACCOUNT});
			const mockTx1 = createMockTx({
				hash: tx1.hash,
				from: tx1.from,
				nonce: 5,
			});
			const mockTx2 = createMockTx({
				hash: tx2.hash,
				from: tx2.from,
				nonce: 6,
			});

			const intent = createIntent({
				transactions: [tx1, tx2],
			});

			controller.addToMempool(mockTx1);
			controller.addToMempool(mockTx2);
			processor.addMultiple({'multi-tx-event': intent});

			// First process: both become Broadcasted
			await processor.process();
			const emittedIntent = getLatestEmission('multi-tx-event');
			expect(emittedIntent?.state?.inclusion).toBe('InMemPool');

			const intentCountAfterBroadcast = intentEmissions.length;
			const statusCountAfterBroadcast = statusEmissions.length;

			// Include TX1 - intent becomes Included
			controller.includeTx(tx1.hash, 'success');
			controller.setAccountNonce(TEST_ACCOUNT, 6);
			await processor.process();

			const afterInclude = getLatestEmission('multi-tx-event');
			expect(afterInclude?.state?.inclusion).toBe('Included');
			expect(afterInclude?.state?.attemptIndex).toBe(0); // TX1

			const intentCountAfterTx1Include = intentEmissions.length;
			const statusCountAfterTx1Include = statusEmissions.length;

			// Both events should have fired (status changed to Included)
			expect(intentCountAfterTx1Include).toBeGreaterThan(intentCountAfterBroadcast);
			expect(statusCountAfterTx1Include).toBeGreaterThan(
				statusCountAfterBroadcast,
			);

			// Now include TX2 - intent is STILL Included (no status change)
			controller.includeTx(tx2.hash, 'success');
			controller.setAccountNonce(TEST_ACCOUNT, 7);
			await processor.process();

			// TX2 should now be Included
			const afterTx2Include = getLatestEmission('multi-tx-event');
			expect(afterTx2Include?.transactions[1].state?.inclusion).toBe(
				'Included',
			);

			// 'intent' event should fire (TX2 changed)
			expect(intentEmissions.length).toBeGreaterThan(intentCountAfterTx1Include);

			// 'intent:status' should NOT fire (status still Included)
			// Note: attemptIndex won't change because TX1 was first success
			expect(statusEmissions.length).toBe(statusCountAfterTx1Include);
		});

		it('should not emit either event when nothing changes', async () => {
			const tx1 = createBroadcastedTx({nonce: 5});
			const mockTx1 = createMockTx({
				hash: tx1.hash,
				from: tx1.from,
				nonce: 5,
			});
			const intent = createIntent({transactions: [tx1]});

			controller.addToMempool(mockTx1);
			processor.addMultiple({'no-change': intent});

			await processor.process();
			const emittedIntent = getLatestEmission('no-change');
			expect(emittedIntent?.state?.inclusion).toBe('InMemPool');

			const intentCountBefore = intentEmissions.length;
			const statusCountBefore = statusEmissions.length;

			// Process again with no changes
			await processor.process();

			// No new events
			expect(intentEmissions.length).toBe(intentCountBefore);
			expect(statusEmissions.length).toBe(statusCountBefore);
		});

		it('should emit intent event when TX finality changes', async () => {
			/**
			 * When a TX becomes final:
			 * - 'intent' fires (TX changed)
			 * - 'intent:status' may or may not fire depending on if final affects status
			 */

			const tx1 = createBroadcastedTx({nonce: 5});
			const mockTx1 = createMockTx({
				hash: tx1.hash,
				from: tx1.from,
				nonce: 5,
			});
			const intent = createIntent({transactions: [tx1]});

			controller.addToMempool(mockTx1);
			processor.addMultiple({'finality-test': intent});
			await processor.process();

			// Include TX1
			controller.includeTx(tx1.hash, 'success');
			controller.setAccountNonce(TEST_ACCOUNT, 6);
			await processor.process();

			const includedIntent = getLatestEmission('finality-test');
			expect(includedIntent?.state?.inclusion).toBe('Included');
			expect(includedIntent?.transactions[0].state?.final).toBeUndefined(); // Not final yet

			const intentCountBefore = intentEmissions.length;
			const statusCountBefore = statusEmissions.length;

			// Advance blocks past finality threshold (12 blocks)
			controller.advanceBlocks(15);

			await processor.process();

			// TX should now be final
			const finalizedIntent = getLatestEmission('finality-test');
			expect(finalizedIntent?.transactions[0].state?.final).toBeDefined();

			// 'intent' event should fire (TX finality changed)
			expect(intentEmissions.length).toBeGreaterThan(intentCountBefore);

			// 'intent:status' should also fire (final field changed)
			expect(statusEmissions.length).toBeGreaterThan(statusCountBefore);
		});
	});

	describe('offOperationStatus', () => {
		it('should stop receiving intent:status events after unsubscribe', async () => {
			const tx1 = createBroadcastedTx({nonce: 5});
			const mockTx1 = createMockTx({
				hash: tx1.hash,
				from: tx1.from,
				nonce: 5,
			});
			const intent = createIntent({transactions: [tx1]});

			controller.addToMempool(mockTx1);
			processor.addMultiple({'unsub-test': intent});

			// First process triggers events
			await processor.process();
			expect(statusEmissions.length).toBe(1);

			// Unsubscribe from status events
			cleanupStatus();

			// Include TX1 - triggers status change
			controller.includeTx(tx1.hash, 'success');
			controller.setAccountNonce(TEST_ACCOUNT, 6);
			await processor.process();

			// Status emissions should NOT increase (unsubscribed)
			expect(statusEmissions.length).toBe(1);

			// But intent emissions should still work
			expect(intentEmissions.length).toBeGreaterThan(1);
		});
	});
});
