import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	createTestSetup,
	addSingleTxIntent,
	processAndWait,
	getLatestEmissionForIntent,
	type TestSetup,
} from '../helpers/scenarios.js';
import {
	assertIntentInclusion,
	assertIntentIncluded,
} from '../helpers/assertions.js';
import {resetHashCounter} from '../fixtures/transactions.js';
import {resetIntentIdCounter} from '../fixtures/intents.js';

/**
 * Reproduces the real-world failure where an injected wallet (MetaMask)
 * deterministically errors on `eth_getTransactionByHash` for a specific tx
 * (observed as a wrapped -32603 / node -32602 "Invalid string length"), which,
 * before isolation, aborted the whole `process()` cycle and wedged every intent.
 *
 * With per-intent isolation, one failing tx no longer prevents sibling intents
 * from resolving, and `process()` does not reject.
 */
describe('Per-intent error isolation', () => {
	let setup: TestSetup;

	beforeEach(() => {
		resetHashCounter();
		resetIntentIdCounter();
		setup = createTestSetup({finality: 12});
	});

	afterEach(() => {
		setup.cleanup();
	});

	it('a tx that always errors on getTransactionByHash does not block other intents', async () => {
		const bad = addSingleTxIntent(setup, {nonce: 1});
		const good = addSingleTxIntent(setup, {nonce: 2});
		const badHash = bad.intent.transactions[0].hash;
		const goodHash = good.intent.transactions[0].hash;

		bad.addToMempool();
		good.addToMempool();

		// Establish the bad intent at InMemPool BEFORE the wallet starts erroring,
		// so we can later assert its state is preserved (not wedged) on error.
		await processAndWait(setup);
		assertIntentInclusion(
			getLatestEmissionForIntent(setup, bad.intentId)!,
			'InMemPool',
		);

		// Simulate the wallet deterministically failing the lookup for ONE tx.
		setup.controller.onRequest((method, params) => {
			if (
				method === 'eth_getTransactionByHash' &&
				(params as string[])[0] === badHash
			) {
				throw new Error('Internal JSON-RPC error (simulated wallet failure)');
			}
		});

		// Mine the good tx.
		setup.controller.includeTx(goodHash, 'success');

		// process() must NOT reject despite the bad tx erroring every time.
		await expect(processAndWait(setup)).resolves.toBeUndefined();

		// The good intent resolves to Included; the bad one is simply retried.
		assertIntentIncluded(
			getLatestEmissionForIntent(setup, good.intentId)!,
			'Success',
		);
		// Bad intent's state is PRESERVED at InMemPool rather than wedging the loop.
		assertIntentInclusion(
			getLatestEmissionForIntent(setup, bad.intentId)!,
			'InMemPool',
		);
	});

	it('recovers the failing tx once the wallet stops erroring', async () => {
		const bad = addSingleTxIntent(setup, {nonce: 1});
		const badHash = bad.intent.transactions[0].hash;
		bad.addToMempool();

		let failLookup = true;
		setup.controller.onRequest((method, params) => {
			if (
				failLookup &&
				method === 'eth_getTransactionByHash' &&
				(params as string[])[0] === badHash
			) {
				throw new Error('Internal JSON-RPC error (simulated wallet failure)');
			}
		});

		setup.controller.includeTx(badHash, 'success');

		// While the wallet errors, the tx is not confirmed but the loop survives.
		await expect(processAndWait(setup)).resolves.toBeUndefined();

		// Wallet recovers; next tick confirms inclusion.
		failLookup = false;
		await processAndWait(setup);
		assertIntentIncluded(
			getLatestEmissionForIntent(setup, bad.intentId)!,
			'Success',
		);
	});
});
