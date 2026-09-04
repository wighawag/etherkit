/**
 * Only an OBSERVED nonce may declare a transaction dropped.
 *
 * A consumer feeds the nonce it INTENDED at broadcast time. A wallet is free
 * to sign a different one, so "the account's nonce is past the one I was
 * given" proves nothing about the transaction the wallet actually sent.
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
	TEST_ACCOUNT_2,
} from '../fixtures/transactions.js';
import {createIntent, resetIntentIdCounter} from '../fixtures/intents.js';

describe('Drop detection requires an observed nonce', () => {
	beforeEach(() => {
		resetHashCounter();
		resetIntentIdCounter();
	});

	it('stops polling once the supplied nonce is spent for good, without lying about it', async () => {
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});
		const updates: TransactionIntentEvent[] = [];
		observer.on('intent:updated', (event) => updates.push(event));

		const calls: string[] = [];
		controller.onRequest((method) => {
			calls.push(method);
		});

		// Never seen on chain, and the account has moved past the nonce the app
		// intended, in finalized history (the mock answers the same count for
		// any block).
		const tx = createBroadcastedTx({nonce: 5, from: TEST_ACCOUNT});
		observer.add('gone', createIntent({transactions: [tx]}));
		controller.setAccountNonce(TEST_ACCOUNT, 6);

		await observer.process();
		expect(updates[updates.length - 1].intent.state?.inclusion).toBe(
			'NotFound',
		);

		// There is nothing left to learn: the hash was never seen and the nonce
		// is finalized-spent. Further ticks must cost nothing at all, rather
		// than polling this transaction for the life of the stored record.
		const callsAfterFirstTick = calls.length;
		await observer.process();
		await observer.process();
		expect(calls.length).toBe(callsAfterFirstTick);

		// And the reported state is still the honest one, not Dropped.
		expect(updates[updates.length - 1].intent.state?.inclusion).toBe(
			'NotFound',
		);
	});

	it('keeps ignoring it while a live intent keeps the tick running', async () => {
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});

		const lookups: string[] = [];
		controller.onRequest((method, params) => {
			if (method === 'eth_getTransactionByHash') {
				lookups.push(params[0] as string);
			}
		});

		const gone = createBroadcastedTx({nonce: 5, from: TEST_ACCOUNT});
		observer.add('gone', createIntent({transactions: [gone]}));
		controller.setAccountNonce(TEST_ACCOUNT, 6);

		// A neighbour that IS worth polling, so process() keeps working.
		const live = createBroadcastedTx({nonce: 0, from: TEST_ACCOUNT_2});
		observer.add('live', createIntent({transactions: [live]}));
		controller.addToMempool(
			createMockTx({hash: live.hash, from: live.from, nonce: 0}),
		);

		await observer.process();
		const goneLookupsAfterFirstTick = lookups.filter(
			(hash) => hash === gone.hash,
		).length;
		expect(goneLookupsAfterFirstTick).toBeGreaterThan(0);

		await observer.process();
		await observer.process();

		// The neighbour is still polled...
		expect(lookups.filter((hash) => hash === live.hash).length).toBe(3);
		// ...and the abandoned transaction is never asked about again.
		expect(lookups.filter((hash) => hash === gone.hash).length).toBe(
			goneLookupsAfterFirstTick,
		);
	});

	it('stays NotFound when the nonce was only supplied by the consumer', async () => {
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});
		const updates: TransactionIntentEvent[] = [];
		observer.on('intent:updated', (event) => updates.push(event));

		// The consumer says nonce 5. The transaction was never seen on chain, so
		// the observer has no way to confirm that number.
		const tx = createBroadcastedTx({nonce: 5, from: TEST_ACCOUNT});
		observer.add('intended-nonce', createIntent({transactions: [tx]}));

		// The account has moved past nonce 5 and the hash is unknown to the node:
		// the old rule would have called this Dropped.
		controller.setAccountNonce(TEST_ACCOUNT, 6);
		await observer.process();

		const latest = updates[updates.length - 1].intent;
		expect(latest.state?.inclusion).toBe('NotFound');
		expect(latest.transactions[0].nonceObserved).toBeUndefined();
	});

	it('drops on the nonce the wallet actually used, not the one it was given', async () => {
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});
		const updates: TransactionIntentEvent[] = [];
		observer.on('intent:updated', (event) => updates.push(event));

		// The app asked for nonce 5; the wallet signed nonce 7 instead.
		const tx = createBroadcastedTx({nonce: 5, from: TEST_ACCOUNT});
		observer.add('wallet-override', createIntent({transactions: [tx]}));
		controller.addToMempool(
			createMockTx({hash: tx.hash, from: tx.from, nonce: 7}),
		);

		await observer.process();
		const broadcasted = updates[updates.length - 1].intent;
		expect(broadcasted.state?.inclusion).toBe('InMemPool');
		expect(broadcasted.transactions[0].nonce).toBe(7);
		expect(broadcasted.transactions[0].nonceObserved).toBe(true);

		// The account passes the INTENDED nonce (5 -> 6) while the transaction is
		// still pending at 7. It must not be reported as dropped.
		controller.removeFromMempool(tx.hash);
		controller.setAccountNonce(TEST_ACCOUNT, 6);
		await observer.process();
		expect(updates[updates.length - 1].intent.state?.inclusion).toBe(
			'NotFound',
		);

		// The account passes the OBSERVED nonce: now the drop is real.
		controller.setAccountNonce(TEST_ACCOUNT, 8);
		await observer.process();
		const dropped = updates[updates.length - 1].intent;
		expect(dropped.state?.inclusion).toBe('Dropped');
		expect(dropped.state?.final).toBe(true);
		expect(dropped.transactions[0].state).toEqual({
			inclusion: 'Dropped',
			final: true,
		});
	});
});
