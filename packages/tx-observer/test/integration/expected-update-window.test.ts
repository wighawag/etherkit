/**
 * The window an out-of-band watch runs over.
 *
 * Detection is not implemented yet, but `fromBlock` is filled and emitted now:
 * it is what the consumer persists. If it were recomputed on every reload, an
 * event that landed while the app was closed would fall permanently outside
 * the window.
 */
import {describe, it, expect, beforeEach} from 'vitest';
import {
	createTransactionObserver,
	type ExpectedUpdate,
	type TransactionIntentEvent,
} from '../../src/index.js';
import {createMockProvider} from '../mocks/MockEIP1193Provider.js';
import {
	createBroadcastedTx,
	createMockTx,
	resetHashCounter,
	TEST_ACCOUNT,
} from '../fixtures/transactions.js';
import {createIntent, resetIntentIdCounter} from '../fixtures/intents.js';

const EXPECTED_EVENT: ExpectedUpdate = {
	address: '0xcccccccccccccccccccccccccccccccccccccccc',
	event: {
		topics: [
			'0x0000000000000000000000000000000000000000000000000000000000000001',
		],
	},
};

describe('expectedUpdate window', () => {
	beforeEach(() => {
		resetHashCounter();
		resetIntentIdCounter();
	});

	it('fills fromBlock on the first tick and emits it for persistence', async () => {
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});
		const updates: TransactionIntentEvent[] = [];
		observer.on('intent:updated', (event) => updates.push(event));

		const tx = createBroadcastedTx({nonce: 0, from: TEST_ACCOUNT});
		observer.add(
			'watched',
			createIntent({transactions: [tx], expectedUpdate: EXPECTED_EVENT}),
		);
		controller.addToMempool(
			createMockTx({hash: tx.hash, from: tx.from, nonce: 0}),
		);

		// No block polled yet when add() ran, so the window is filled by the
		// first process() instead.
		expect(updates.length).toBe(0);

		const blockNumber = controller.getBlockNumber();
		await observer.process();

		expect(updates.length).toBe(1);
		expect(updates[0].intent.expectedUpdate?.fromBlock).toBe(blockNumber);
	});

	it('fills fromBlock inside add() once a block is known, with no extra RPC', async () => {
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});

		// Give the observer a chain head to work from.
		const first = createBroadcastedTx({nonce: 0, from: TEST_ACCOUNT});
		observer.add('first', createIntent({transactions: [first]}));
		controller.addToMempool(
			createMockTx({hash: first.hash, from: first.from, nonce: 0}),
		);
		await observer.process();

		const updates: TransactionIntentEvent[] = [];
		observer.on('intent:updated', (event) => updates.push(event));

		controller.advanceBlocks(3);
		// The window comes from the last polled block: creating an intent must
		// not cost an RPC of its own.
		const knownBlockNumber = controller.getBlockNumber() - 3;

		const tx = createBroadcastedTx({nonce: 1, from: TEST_ACCOUNT});
		observer.add(
			'watched',
			createIntent({transactions: [tx], expectedUpdate: EXPECTED_EVENT}),
		);

		expect(updates.length).toBe(1);
		expect(updates[0].id).toBe('watched');
		expect(updates[0].intent.expectedUpdate?.fromBlock).toBe(knownBlockNumber);
	});

	it('windows a watch-only intent, the one case the field exists for', async () => {
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});
		const updates: TransactionIntentEvent[] = [];
		observer.on('intent:updated', (event) => updates.push(event));

		const calls: string[] = [];
		controller.onRequest((method) => {
			calls.push(method);
		});

		// No transaction of its own: this intent can only ever be satisfied by
		// the effect it is watching for. It still needs a window, and it must
		// get one without a live neighbour to keep the tick alive.
		observer.add(
			'watch-only',
			createIntent({transactions: [], expectedUpdate: EXPECTED_EVENT}),
		);

		const blockNumber = controller.getBlockNumber();
		await observer.process();

		expect(updates.length).toBe(1);
		expect(updates[0].intent.expectedUpdate?.fromBlock).toBe(blockNumber);

		// Having been windowed, it has nothing left to ask until detection
		// exists: no RPC on the following ticks.
		const callsAfterFirstTick = calls.length;
		await observer.process();
		await observer.process();
		expect(calls.length).toBe(callsAfterFirstTick);
	});

	it('adopts a watch attached to an intent that already exists', async () => {
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});
		const updates: TransactionIntentEvent[] = [];
		observer.on('intent:updated', (event) => updates.push(event));

		// Register the intent first (on click), attach the watch later (once the
		// event signature is known). The second add() must not drop it.
		const tx = createBroadcastedTx({nonce: 0, from: TEST_ACCOUNT});
		observer.add('two-step', createIntent({transactions: [tx]}));
		controller.addToMempool(
			createMockTx({hash: tx.hash, from: tx.from, nonce: 0}),
		);
		await observer.process();

		observer.add(
			'two-step',
			createIntent({transactions: [], expectedUpdate: EXPECTED_EVENT}),
		);

		const latest = updates[updates.length - 1].intent;
		expect(latest.expectedUpdate?.event).toEqual(EXPECTED_EVENT.event);
		// And it is windowed from the block already known, not left open.
		expect(latest.expectedUpdate?.fromBlock).toBe(controller.getBlockNumber());

		// A second attach never replaces the first: that would move fromBlock.
		controller.advanceBlocks(4);
		observer.add(
			'two-step',
			createIntent({
				transactions: [],
				expectedUpdate: {...EXPECTED_EVENT, fromBlock: 9999},
			}),
		);
		await observer.process();
		expect(updates[updates.length - 1].intent.expectedUpdate?.fromBlock).toBe(
			latest.expectedUpdate?.fromBlock,
		);
	});

	it('never overwrites a window the caller supplied, and never refills its own', async () => {
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});
		const updates: TransactionIntentEvent[] = [];
		observer.on('intent:updated', (event) => updates.push(event));

		const tx = createBroadcastedTx({nonce: 0, from: TEST_ACCOUNT});
		observer.add(
			'watched',
			createIntent({
				transactions: [tx],
				expectedUpdate: {
					...EXPECTED_EVENT,
					fromBlock: 42,
					until: {kind: 'block', blockNumber: 1000},
				},
			}),
		);
		controller.addToMempool(
			createMockTx({hash: tx.hash, from: tx.from, nonce: 0}),
		);

		await observer.process();
		controller.advanceBlocks(5);
		await observer.process();

		for (const update of updates) {
			expect(update.intent.expectedUpdate?.fromBlock).toBe(42);
			expect(update.intent.expectedUpdate?.until).toEqual({
				kind: 'block',
				blockNumber: 1000,
			});
		}
	});

	it('keeps the filled window stable across later ticks', async () => {
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});
		const updates: TransactionIntentEvent[] = [];
		observer.on('intent:updated', (event) => updates.push(event));

		const tx = createBroadcastedTx({nonce: 0, from: TEST_ACCOUNT});
		observer.add(
			'watched',
			createIntent({transactions: [tx], expectedUpdate: EXPECTED_EVENT}),
		);
		controller.addToMempool(
			createMockTx({hash: tx.hash, from: tx.from, nonce: 0}),
		);

		const blockNumber = controller.getBlockNumber();
		await observer.process();
		controller.advanceBlocks(4);
		controller.includeTx(tx.hash, 'success');
		await observer.process();

		expect(updates.length).toBeGreaterThan(1);
		expect(updates[updates.length - 1].intent.expectedUpdate?.fromBlock).toBe(
			blockNumber,
		);
	});
});
