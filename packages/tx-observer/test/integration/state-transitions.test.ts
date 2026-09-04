/**
 * Transitions of the intent state, including the ones that only exist because
 * `via` is a discriminated union rather than an index.
 */
import {describe, it, expect, beforeEach} from 'vitest';
import {
	createTransactionObserver,
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

describe('Intent state transitions', () => {
	beforeEach(() => {
		resetHashCounter();
		resetIntentIdCounter();
	});

	it('emits intent:state when an Included intent switches between via arms, with every other field equal', async () => {
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});

		// Run the transaction to Included first, so we know the exact
		// `blockTimestamp` and `final` the recomputed state will carry.
		const tx = createBroadcastedTx({nonce: 0, from: TEST_ACCOUNT});
		observer.add('probe', createIntent({transactions: [tx]}));
		controller.addToMempool(
			createMockTx({hash: tx.hash, from: tx.from, nonce: 0}),
		);
		controller.includeTx(tx.hash, 'success');
		await observer.process();
		const included = controller.getBlockByHash(
			controller.getTransaction(tx.hash)!.blockHash!,
		)!;
		const blockTimestamp = Number(included.timestamp);

		// Now a SECOND observer over the same chain, seeded with a
		// hand-constructed "won by an out-of-band effect" state whose
		// inclusion, outcome, final AND blockTimestamp are all exactly what the
		// attempt will produce. Only `via` differs, so this transition is
		// detected by the structural `via` comparison or not at all.
		const observer2 = createTransactionObserver({finality: 12, provider});
		const stateEvents: TransactionIntentEvent[] = [];
		observer2.on('intent:state', (event) => stateEvents.push(event));
		observer2.add(
			'out-of-band',
			createIntent({
				transactions: [createBroadcastedTx({hash: tx.hash, nonce: 0})],
				state: {
					inclusion: 'Included',
					outcome: 'Success',
					final: false,
					blockTimestamp,
					via: {kind: 'expectedUpdate', blockNumber: 1},
				},
			}),
		);

		await observer2.process();

		expect(stateEvents.length).toBe(1);
		expect(stateEvents[0].intent.state).toEqual({
			inclusion: 'Included',
			outcome: 'Success',
			final: false,
			blockTimestamp,
			via: {kind: 'attempt', attemptIndex: 0},
		});
	});

	it('emits intent:state when only the winning attempt index changes', async () => {
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});

		const stateEvents: TransactionIntentEvent[] = [];
		observer.on('intent:state', (event) => stateEvents.push(event));

		// Two attempts, both Success, both included in the SAME block: inclusion,
		// outcome, final and blockTimestamp are identical for either winner, so
		// only `via.attemptIndex` can tell the two states apart.
		const tx1 = createBroadcastedTx({nonce: 0, from: TEST_ACCOUNT});
		const tx2 = createBroadcastedTx({nonce: 1, from: TEST_ACCOUNT});
		controller.addToMempool(
			createMockTx({hash: tx1.hash, from: tx1.from, nonce: 0}),
		);
		controller.addToMempool(
			createMockTx({hash: tx2.hash, from: tx2.from, nonce: 1}),
		);
		controller.includeTxs([tx1.hash, tx2.hash], 'success');
		const blockTimestamp = Number(
			controller.getBlockByHash(
				controller.getTransaction(tx2.hash)!.blockHash!,
			)!.timestamp,
		);

		// Seeded as won by attempt 1; the recomputed winner is attempt 0, the
		// first success in the list.
		observer.add(
			'two-winners',
			createIntent({
				transactions: [
					createBroadcastedTx({hash: tx1.hash, nonce: 0}),
					createBroadcastedTx({hash: tx2.hash, nonce: 1}),
				],
				state: {
					inclusion: 'Included',
					outcome: 'Success',
					final: false,
					blockTimestamp,
					via: {kind: 'attempt', attemptIndex: 1},
				},
			}),
		);

		await observer.process();

		expect(stateEvents.length).toBe(1);
		expect(stateEvents[0].intent.state).toEqual({
			inclusion: 'Included',
			outcome: 'Success',
			final: false,
			blockTimestamp,
			via: {kind: 'attempt', attemptIndex: 0},
		});
	});

	it('keeps a persisted expectedUpdate win: an observed effect cannot be un-observed', async () => {
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});

		const stateEvents: TransactionIntentEvent[] = [];
		observer.on('intent:state', (event) => stateEvents.push(event));

		// The intent was proved by an effect on chain that its own transaction
		// did not produce, and that transaction is nowhere to be found. Nothing
		// here can disprove the effect, so the state must survive the tick.
		const tx = createBroadcastedTx({nonce: 0, from: TEST_ACCOUNT});
		const state = {
			inclusion: 'Included',
			outcome: 'Success',
			final: true,
			via: {kind: 'expectedUpdate', blockNumber: 100},
		} as const;
		observer.add('proved', createIntent({transactions: [tx], state}));

		await observer.process();
		expect(stateEvents.length).toBe(0);

		// Even a failed attempt of its own does not undo it.
		controller.addToMempool(
			createMockTx({hash: tx.hash, from: tx.from, nonce: 0}),
		);
		controller.includeTx(tx.hash, 'failure');
		await observer.process();
		expect(stateEvents.length).toBe(0);

		// A successful attempt does replace it: it points at a hash, which is
		// strictly more information.
		const tx2 = createBroadcastedTx({nonce: 1, from: TEST_ACCOUNT});
		observer.add('proved', createIntent({transactions: [tx2]}));
		controller.addToMempool(
			createMockTx({hash: tx2.hash, from: tx2.from, nonce: 1}),
		);
		controller.includeTx(tx2.hash, 'success');
		await observer.process();
		expect(stateEvents.length).toBe(1);
		expect(stateEvents[0].intent.state?.via).toEqual({
			kind: 'attempt',
			attemptIndex: 1,
		});
	});

	it('reports NotFound when one transaction is dropped and another was never looked at', async () => {
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});

		const stateEvents: TransactionIntentEvent[] = [];
		observer.on('intent:state', (event) => stateEvents.push(event));

		// A restored record: one attempt is known dropped, the other has no
		// state at all. Nothing observed the second one, so the intent has NOT
		// failed. Reading it as Dropped would tell the user their action died.
		const dropped = createBroadcastedTx({
			nonce: 0,
			from: TEST_ACCOUNT,
			nonceObserved: true,
			state: {inclusion: 'Dropped', final: true},
		});
		const unknown = createBroadcastedTx({nonce: 1, from: TEST_ACCOUNT});
		observer.add(
			'partly-known',
			createIntent({transactions: [dropped, unknown]}),
		);

		// The second transaction is not in the mempool and its nonce is not
		// spent, so it stays NotFound rather than becoming Dropped.
		await observer.process();

		expect(stateEvents.length).toBe(1);
		expect(stateEvents[0].intent.state).toEqual({inclusion: 'NotFound'});
	});

	it('does not report Dropped for an attempt that arrived mid-tick and was never looked at', async () => {
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});

		const stateEvents: TransactionIntentEvent[] = [];
		observer.on('intent:state', (event) => stateEvents.push(event));

		// One attempt, already dropped and finalized as such.
		const dropped = createBroadcastedTx({
			nonce: 0,
			from: TEST_ACCOUNT,
			nonceObserved: true,
		});
		observer.add('bumping', createIntent({transactions: [dropped]}));
		controller.setAccountNonce(TEST_ACCOUNT, 1);

		// The user bumps gas WHILE the tick is running: the replacement lands in
		// the intent after the snapshot was taken, so it has no state at all
		// when the intent state is computed. It proves nothing, in either
		// direction, and must not be counted as "dropped like the others".
		const replacement = createBroadcastedTx({nonce: 1, from: TEST_ACCOUNT});
		let added = false;
		const unhook = controller.onRequest((method) => {
			if (!added && method === 'eth_getTransactionByHash') {
				added = true;
				observer.add('bumping', createIntent({transactions: [replacement]}));
			}
			return undefined;
		});

		await observer.process();
		unhook();

		expect(stateEvents.length).toBe(1);
		expect(stateEvents[0].intent.transactions.length).toBe(2);
		expect(stateEvents[0].intent.transactions[1].state).toBeUndefined();
		expect(stateEvents[0].intent.state).toEqual({inclusion: 'NotFound'});
	});

	it('emits intent:state when an attempt failure is beaten by a later success', async () => {
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});

		const stateEvents: TransactionIntentEvent[] = [];
		observer.on('intent:state', (event) => stateEvents.push(event));

		const tx1 = createBroadcastedTx({nonce: 0, from: TEST_ACCOUNT});
		const tx2 = createBroadcastedTx({nonce: 1, from: TEST_ACCOUNT});
		observer.add('two-attempts', createIntent({transactions: [tx1, tx2]}));
		controller.addToMempool(
			createMockTx({hash: tx1.hash, from: tx1.from, nonce: 0}),
		);
		controller.addToMempool(
			createMockTx({hash: tx2.hash, from: tx2.from, nonce: 1}),
		);

		// TX1 reverts: the intent is a Failure won by attempt 0.
		controller.includeTx(tx1.hash, 'failure');
		await observer.process();
		const failure = stateEvents[stateEvents.length - 1];
		expect(failure.intent.state?.outcome).toBe('Failure');
		expect(failure.intent.state?.via).toEqual({
			kind: 'attempt',
			attemptIndex: 0,
		});

		// TX2 succeeds: same inclusion, different attempt, so the state changed.
		controller.includeTx(tx2.hash, 'success');
		await observer.process();
		const success = stateEvents[stateEvents.length - 1];
		expect(success.intent.state?.outcome).toBe('Success');
		expect(success.intent.state?.via).toEqual({
			kind: 'attempt',
			attemptIndex: 1,
		});
	});

	it('reads an intent with zero transactions as NotFound, never Dropped', async () => {
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});

		const stateEvents: TransactionIntentEvent[] = [];
		const updateEvents: TransactionIntentEvent[] = [];
		observer.on('intent:state', (event) => stateEvents.push(event));
		observer.on('intent:updated', (event) => updateEvents.push(event));

		// An intent created before its first broadcast. Nothing about it failed;
		// reporting Dropped would tell the user their action died.
		observer.add('not-broadcasted-yet', createIntent({transactions: []}));

		// A second, live intent keeps the tick alive: an intent with no
		// transaction has nothing to poll, so process() would otherwise skip
		// the whole cycle.
		const tx = createBroadcastedTx({nonce: 0, from: TEST_ACCOUNT});
		observer.add('live', createIntent({transactions: [tx]}));
		controller.addToMempool(
			createMockTx({hash: tx.hash, from: tx.from, nonce: 0}),
		);

		await observer.process();

		const empty = stateEvents.filter(
			(event) => event.id === 'not-broadcasted-yet',
		);
		expect(empty.length).toBe(1);
		expect(empty[0].intent.state).toEqual({inclusion: 'NotFound'});

		// A state change is worth persisting: a consumer that stores on
		// 'intent:updated' must not end up with a state the UI never saw.
		const persisted = updateEvents.filter(
			(event) => event.id === 'not-broadcasted-yet',
		);
		expect(persisted.length).toBe(1);
		expect(persisted[0].intent.state).toEqual({inclusion: 'NotFound'});
	});
});
