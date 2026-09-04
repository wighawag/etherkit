/**
 * Tests for the dual-event system:
 * - 'intent' event: fires when any TX in the intent changes (for persistence)
 * - 'intent:state' event: fires only when intent state changes (for UI/state)
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	createTransactionObserver,
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
	let processor: ReturnType<typeof createTransactionObserver>;
	let controller: MockProviderController;
	let intentEmissions: TransactionIntent[];
	let intentEvents: TransactionIntentEvent[];
	let stateEmissions: TransactionIntent[];
	let cleanupIntent: () => void;
	let cleanupState: () => void;

	beforeEach(() => {
		resetHashCounter();
		resetIntentIdCounter();

		const {provider, controller: ctrl} = createMockProvider();
		controller = ctrl;

		processor = createTransactionObserver({
			finality: 12,
			provider,
		});

		intentEmissions = [];
		intentEvents = [];
		stateEmissions = [];

		// Listen to both event types
		cleanupIntent = processor.on('intent:updated', (event) => {
			intentEmissions.push(structuredClone(event.intent));
			intentEvents.push(structuredClone(event));
			return () => {};
		});

		cleanupState = processor.on('intent:state', (event) => {
			stateEmissions.push(structuredClone(event.intent));
			return () => {};
		});
	});

	afterEach(() => {
		cleanupIntent();
		cleanupState();
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

	describe('intent vs intent:state events', () => {
		it('should emit both events when intent state changes', async () => {
			const tx1 = createBroadcastedTx({nonce: 5});
			const mockTx1 = createMockTx({
				hash: tx1.hash,
				from: tx1.from,
				nonce: 5,
			});
			const intent = createIntent({transactions: [tx1]});

			controller.addToMempool(mockTx1);
			processor.addMultiple({'dual-emit': intent});

			// First process: BeingFetched -> Broadcasted (state change)
			await processor.process();

			// Both events should fire for initial state change
			expect(intentEmissions.length).toBe(1);
			expect(stateEmissions.length).toBe(1);

			expect(intentEmissions[0].state?.inclusion).toBe('InMemPool');
			expect(stateEmissions[0].state?.inclusion).toBe('InMemPool');
		});

		it('should emit intent but NOT intent:state when only TX changes without a state change', async () => {
			/**
			 * Scenario:
			 * - Intent has TX1 (Broadcasted) and TX2 (Broadcasted)
			 * - TX1 becomes Included (Success)
			 * - TX2 also becomes Included (Success)
			 *
			 * After TX1 inclusion:
			 * - Intent state: Included (changed)
			 * - Both events fire
			 *
			 * After TX2 inclusion:
			 * - Intent state: still Included (no change)
			 * - Only 'intent' event fires (TX2 changed)
			 * - 'intent:state' does NOT fire (state unchanged)
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
			const stateCountAfterBroadcast = stateEmissions.length;

			// Include TX1 - intent becomes Included
			controller.includeTx(tx1.hash, 'success');
			controller.setAccountNonce(TEST_ACCOUNT, 6);
			await processor.process();

			const afterInclude = getLatestEmission('multi-tx-event');
			expect(afterInclude?.state?.inclusion).toBe('Included');
			expect(afterInclude?.state?.via).toEqual({
				kind: 'attempt',
				attemptIndex: 0,
			}); // TX1

			const intentCountAfterTx1Include = intentEmissions.length;
			const stateCountAfterTx1Include = stateEmissions.length;

			// Both events should have fired (state changed to Included)
			expect(intentCountAfterTx1Include).toBeGreaterThan(
				intentCountAfterBroadcast,
			);
			expect(stateCountAfterTx1Include).toBeGreaterThan(
				stateCountAfterBroadcast,
			);

			// Now include TX2 - intent is STILL Included (no state change)
			controller.includeTx(tx2.hash, 'success');
			controller.setAccountNonce(TEST_ACCOUNT, 7);
			await processor.process();

			// TX2 should now be Included
			const afterTx2Include = getLatestEmission('multi-tx-event');
			expect(afterTx2Include?.transactions[1].state?.inclusion).toBe(
				'Included',
			);

			// 'intent' event should fire (TX2 changed)
			expect(intentEmissions.length).toBeGreaterThan(
				intentCountAfterTx1Include,
			);

			// 'intent:state' should NOT fire (state still Included)
			// Note: attemptIndex won't change because TX1 was first success
			expect(stateEmissions.length).toBe(stateCountAfterTx1Include);
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
			const stateCountBefore = stateEmissions.length;

			// Process again with no changes
			await processor.process();

			// No new events
			expect(intentEmissions.length).toBe(intentCountBefore);
			expect(stateEmissions.length).toBe(stateCountBefore);
		});

		it('should emit intent event when TX finality changes', async () => {
			/**
			 * When a TX becomes final:
			 * - 'intent' fires (TX changed)
			 * - 'intent:state' may or may not fire depending on if final affects the state
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
			expect(includedIntent?.transactions[0].state?.final).toBe(false); // Not final yet

			const intentCountBefore = intentEmissions.length;
			const stateCountBefore = stateEmissions.length;

			// Advance blocks past finality threshold (12 blocks)
			controller.advanceBlocks(15);

			await processor.process();

			// TX should now be final
			const finalizedIntent = getLatestEmission('finality-test');
			expect(finalizedIntent?.transactions[0].state?.final).toBe(true);

			// 'intent' event should fire (TX finality changed)
			expect(intentEmissions.length).toBeGreaterThan(intentCountBefore);

			// 'intent:state' should also fire (final field changed)
			expect(stateEmissions.length).toBeGreaterThan(stateCountBefore);
		});
	});

	describe('offOperationStatus', () => {
		it('should stop receiving intent:state events after unsubscribe', async () => {
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
			expect(stateEmissions.length).toBe(1);

			// Unsubscribe from state events
			cleanupState();

			// Include TX1 - triggers a state change
			controller.includeTx(tx1.hash, 'success');
			controller.setAccountNonce(TEST_ACCOUNT, 6);
			await processor.process();

			// Status emissions should NOT increase (unsubscribed)
			expect(stateEmissions.length).toBe(1);

			// But intent emissions should still work
			expect(intentEmissions.length).toBeGreaterThan(1);
		});
	});
});
