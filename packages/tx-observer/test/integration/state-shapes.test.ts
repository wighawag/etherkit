/**
 * Shape tests for the two persisted state unions.
 *
 * Consumers store `BroadcastedTransactionState` and `TransactionIntentState`
 * verbatim and hand them back to `add()` on reload, so both the arms and the
 * keys that must NOT exist on an arm are part of the contract.
 *
 * The `@ts-expect-error` assertions below are real assertions: `pnpm typecheck`
 * covers `test/**` and fails if the marked line stops being an error.
 */
import {describe, it, expect, beforeEach} from 'vitest';
import {
	createTransactionObserver,
	type BroadcastedTransactionState,
	type ExpectedUpdate,
	type TransactionIntent,
	type TransactionIntentState,
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

describe('State shapes', () => {
	describe('BroadcastedTransactionState arms', () => {
		it('accepts every arm', () => {
			const inMemPool: BroadcastedTransactionState = {inclusion: 'InMemPool'};
			const notFound: BroadcastedTransactionState = {inclusion: 'NotFound'};
			const dropped: BroadcastedTransactionState = {
				inclusion: 'Dropped',
				final: false,
			};
			const droppedFinal: BroadcastedTransactionState = {
				inclusion: 'Dropped',
				final: true,
			};
			const included: BroadcastedTransactionState = {
				inclusion: 'Included',
				outcome: 'Success',
				final: false,
				blockTimestamp: 1700000000,
			};
			const reverted: BroadcastedTransactionState = {
				inclusion: 'Included',
				outcome: 'Failure',
				final: true,
				blockTimestamp: 1700000000,
			};

			expect(
				[inMemPool, notFound, dropped, droppedFinal, included, reverted].map(
					(state) => state.inclusion,
				),
			).toEqual([
				'InMemPool',
				'NotFound',
				'Dropped',
				'Dropped',
				'Included',
				'Included',
			]);
		});

		it('an Included transaction may carry its block timestamp before it is final', () => {
			const minedNotFinal: BroadcastedTransactionState = {
				inclusion: 'Included',
				outcome: 'Success',
				final: false,
				blockTimestamp: 1700000000,
			};
			expect(minedNotFinal.final).toBe(false);
			expect(minedNotFinal.blockTimestamp).toBe(1700000000);
		});

		it('rejects keys that do not apply to the arm', () => {
			const notFound: BroadcastedTransactionState = {
				inclusion: 'NotFound',
				// @ts-expect-error a transaction that was never seen has no outcome
				outcome: 'Success',
			};
			// @ts-expect-error nothing is final while still in the mempool
			const inMemPool: BroadcastedTransactionState = {
				inclusion: 'InMemPool',
				final: true,
			};
			// @ts-expect-error a dropped transaction was never in a block
			const dropped: BroadcastedTransactionState = {
				inclusion: 'Dropped',
				final: true,
				blockTimestamp: 1700000000,
			};
			expect([notFound, inMemPool, dropped].length).toBe(3);
		});

		it('does not accept the old `status` key or a numeric `final`', () => {
			const withStatus: BroadcastedTransactionState = {
				inclusion: 'Included',
				outcome: 'Success',
				final: true,
				// @ts-expect-error `status` was renamed to `outcome`
				status: 'Success',
			};
			const numericFinal: BroadcastedTransactionState = {
				inclusion: 'Included',
				outcome: 'Success',
				// @ts-expect-error `final` is a boolean, the timestamp is `blockTimestamp`
				final: 1700000000,
			};
			expect([withStatus, numericFinal].length).toBe(2);
		});
	});

	describe('TransactionIntentState arms', () => {
		it('accepts every arm', () => {
			const inMemPool: TransactionIntentState = {inclusion: 'InMemPool'};
			const notFound: TransactionIntentState = {inclusion: 'NotFound'};
			const dropped: TransactionIntentState = {
				inclusion: 'Dropped',
				final: true,
			};
			const wonByAttempt: TransactionIntentState = {
				inclusion: 'Included',
				outcome: 'Failure',
				final: false,
				blockTimestamp: 1700000000,
				via: {kind: 'attempt', attemptIndex: 2},
			};
			const wonByExpectedUpdate: TransactionIntentState = {
				inclusion: 'Included',
				outcome: 'Success',
				final: true,
				// the block the effect was seen in, recorded when the win is made
				via: {kind: 'expectedUpdate', blockNumber: 4242},
			};

			expect(
				wonByAttempt.via?.kind === 'attempt'
					? wonByAttempt.via.attemptIndex
					: undefined,
			).toBe(2);
			expect(wonByExpectedUpdate.via?.kind).toBe('expectedUpdate');
			expect([inMemPool, notFound, dropped].map((state) => state.via)).toEqual([
				undefined,
				undefined,
				undefined,
			]);
		});

		it('does not let an expectedUpdate win carry an attemptIndex', () => {
			const lying: TransactionIntentState = {
				inclusion: 'Included',
				outcome: 'Success',
				final: true,
				// @ts-expect-error there is no attempt behind an out-of-band effect
				via: {kind: 'expectedUpdate', blockNumber: 4242, attemptIndex: 3},
			};
			expect(lying.via?.kind).toBe('expectedUpdate');
		});

		it('does not let an expectedUpdate win omit the block it was seen in', () => {
			// Without it, `final` could never be computed for this arm: unlike an
			// attempt, there is no receipt to recompute it from.
			const undatable: TransactionIntentState = {
				inclusion: 'Included',
				outcome: 'Success',
				final: false,
				// @ts-expect-error an out-of-band win records where it was observed
				via: {kind: 'expectedUpdate'},
			};
			expect(undatable.via?.kind).toBe('expectedUpdate');
		});

		it('does not let an expectedUpdate win be a Failure', () => {
			const impossible: TransactionIntentState = {
				inclusion: 'Included',
				outcome: 'Failure',
				// @ts-expect-error a Failure can only come from an attempt: an
				// observed effect proves something happened, never that it failed
				via: {kind: 'expectedUpdate', blockNumber: 4242},
				final: true,
			};
			expect(impossible.outcome).toBe('Failure');
		});

		it('requires a via on an Included intent', () => {
			// @ts-expect-error an inclusion always has something that proved it
			const noVia: TransactionIntentState = {
				inclusion: 'Included',
				outcome: 'Success',
				final: true,
			};
			expect(noVia.inclusion).toBe('Included');
		});

		it('accepts both watch variants and both until bounds', () => {
			const watchEvent: ExpectedUpdate = {
				address: '0xcccccccccccccccccccccccccccccccccccccccc',
				event: {topics: ['0x00']},
				until: {kind: 'block', blockNumber: 123},
			};
			const watchCall: ExpectedUpdate = {
				address: '0xcccccccccccccccccccccccccccccccccccccccc',
				call: {data: '0xdeadbeef', result: '0x01'},
				until: {kind: 'chainTime', timestampSeconds: 1700000000},
				fromBlock: 1,
			};
			expect([watchEvent.until?.kind, watchCall.until?.kind]).toEqual([
				'block',
				'chainTime',
			]);
		});

		it('does not accept a watch that is both an event and a call, or a wrong bound', () => {
			// @ts-expect-error one watch is one predicate
			const both: ExpectedUpdate = {
				address: '0xcccccccccccccccccccccccccccccccccccccccc',
				event: {topics: []},
				call: {data: '0x', result: '0x'},
			};
			const wrongBound: ExpectedUpdate = {
				address: '0xcccccccccccccccccccccccccccccccccccccccc',
				event: {topics: []},
				// @ts-expect-error a block bound is a block number, not a timestamp
				until: {kind: 'block', timestampSeconds: 1700000000},
			};
			expect([both, wrongBound].length).toBe(2);
		});

		it('narrows to the attempt index only after checking the kind', () => {
			const state: TransactionIntentState = {
				inclusion: 'Included',
				outcome: 'Success',
				final: false,
				via: {kind: 'attempt', attemptIndex: 1},
			};
			const transactions = [createBroadcastedTx({}), createBroadcastedTx({})];
			const winner =
				state.via?.kind === 'attempt'
					? transactions[state.via.attemptIndex]
					: undefined;
			expect(winner?.hash).toBe(transactions[1].hash);
		});
	});
});

describe('State round-trip across a reload', () => {
	beforeEach(() => {
		resetHashCounter();
		resetIntentIdCounter();
	});

	it('replays a persisted intent into a fresh observer without re-emitting its state', async () => {
		const {provider, controller} = createMockProvider();

		const first = createTransactionObserver({finality: 12, provider});
		const firstUpdates: TransactionIntentEvent[] = [];
		first.on('intent:updated', (event) => firstUpdates.push(event));

		const tx = createBroadcastedTx({nonce: 3, from: TEST_ACCOUNT});
		first.add('persisted', createIntent({transactions: [tx]}));
		controller.addToMempool(
			createMockTx({hash: tx.hash, from: tx.from, nonce: 3}),
		);
		await first.process();
		controller.includeTx(tx.hash, 'success');
		await first.process();

		const emitted = firstUpdates[firstUpdates.length - 1].intent;
		expect(emitted.state).toEqual({
			inclusion: 'Included',
			outcome: 'Success',
			final: false,
			blockTimestamp: expect.any(Number),
			via: {kind: 'attempt', attemptIndex: 0},
		});

		// Local storage does exactly this.
		const stored: TransactionIntent = JSON.parse(JSON.stringify(emitted));

		const second = createTransactionObserver({finality: 12, provider});
		const secondStates: TransactionIntentEvent[] = [];
		second.on('intent:state', (event) => secondStates.push(event));
		second.add('persisted', stored);

		// Nothing changed on chain, so the restored state must compare equal to
		// the recomputed one: no state event at all.
		await second.process();
		expect(secondStates.length).toBe(0);

		// And it still moves on from the restored state once finality is reached.
		controller.advanceBlocks(12);
		await second.process();
		expect(secondStates.length).toBe(1);
		expect(secondStates[0].intent.state).toEqual({
			inclusion: 'Included',
			outcome: 'Success',
			final: true,
			blockTimestamp: expect.any(Number),
			via: {kind: 'attempt', attemptIndex: 0},
		});
	});
});
