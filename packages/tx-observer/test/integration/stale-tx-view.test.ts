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
 * Reproduces a real-world issue: an injected wallet (e.g. MetaMask on a local
 * dev chain) caches `eth_getTransactionByHash` and keeps returning a stale
 * pending view (blockHash/blockNumber null) for an already-mined tx, while a
 * direct `eth_getTransactionReceipt` still returns the mined receipt.
 *
 * By default the observer only fetches the receipt when the tx reports a block,
 * so the tx stays stuck as `InMemPool`. `alwaysFetchReceipt` opts into fetching
 * the receipt directly, which recovers the correct `Included` status without
 * needing a separate/hardcoded RPC.
 */
describe('Stale transaction view (cached getTransactionByHash)', () => {
	let setup: TestSetup;

	beforeEach(() => {
		resetHashCounter();
		resetIntentIdCounter();
	});

	afterEach(() => {
		setup.cleanup();
	});

	it('DEFAULT: stays stuck as InMemPool when the provider hides the block on getTransactionByHash', async () => {
		setup = createTestSetup({finality: 12});
		const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
			nonce: 5,
		});
		const txHash = intent.transactions[0].hash;

		addToMempool();
		await processAndWait(setup);
		assertIntentInclusion(
			getLatestEmissionForIntent(setup, intentId)!,
			'InMemPool',
		);

		// Mine the tx, but make the provider keep returning the stale pending view.
		setup.controller.includeTx(txHash, 'success');
		setup.controller.setStaleTransactionView(true);
		await processAndWait(setup);

		// Bug reproduction: the receipt exists on-chain, but because
		// getTransactionByHash reports no block, the observer never checks it.
		assertIntentInclusion(
			getLatestEmissionForIntent(setup, intentId)!,
			'InMemPool',
		);
	});

	it('alwaysFetchReceipt: recovers Included by fetching the receipt directly', async () => {
		setup = createTestSetup({finality: 12, alwaysFetchReceipt: true});
		const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
			nonce: 5,
		});
		const txHash = intent.transactions[0].hash;

		addToMempool();
		await processAndWait(setup);
		assertIntentInclusion(
			getLatestEmissionForIntent(setup, intentId)!,
			'InMemPool',
		);

		// Mine the tx while the provider keeps serving the stale pending view.
		setup.controller.includeTx(txHash, 'success');
		setup.controller.setStaleTransactionView(true);
		await processAndWait(setup);

		// With alwaysFetchReceipt, the direct receipt lookup wins: Included/Success.
		assertIntentIncluded(
			getLatestEmissionForIntent(setup, intentId)!,
			'Success',
		);
	});

	it('alwaysFetchReceipt: reports Failure for a reverted tx hidden behind a stale view', async () => {
		setup = createTestSetup({finality: 12, alwaysFetchReceipt: true});
		const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
			nonce: 5,
		});
		const txHash = intent.transactions[0].hash;

		addToMempool();
		await processAndWait(setup);

		setup.controller.includeTx(txHash, 'failure');
		setup.controller.setStaleTransactionView(true);
		await processAndWait(setup);

		assertIntentIncluded(
			getLatestEmissionForIntent(setup, intentId)!,
			'Failure',
		);
	});

	it('alwaysFetchReceipt: stays InMemPool (no false Included) when the receipt is present but its block is not yet resolvable', async () => {
		setup = createTestSetup({finality: 12, alwaysFetchReceipt: true});
		const {intent, intentId, addToMempool} = addSingleTxIntent(setup, {
			nonce: 5,
		});
		const txHash = intent.transactions[0].hash;

		addToMempool();
		await processAndWait(setup);
		assertIntentInclusion(
			getLatestEmissionForIntent(setup, intentId)!,
			'InMemPool',
		);

		// Mine the tx: the receipt now exists. But the provider serves the stale
		// pending view AND cannot resolve the block via eth_getBlockByHash yet
		// (a lagging node that has surfaced the receipt but not the block).
		setup.controller.includeTx(txHash, 'success');
		setup.controller.setStaleTransactionView(true);
		setup.controller.setHideBlockByHash(true);
		await processAndWait(setup);

		// Having a receipt is not enough: without the block we cannot compute
		// finality, so we must not report a false Included. Stay InMemPool.
		assertIntentInclusion(
			getLatestEmissionForIntent(setup, intentId)!,
			'InMemPool',
		);

		// Once the node surfaces the block, the next tick recovers Included.
		setup.controller.setHideBlockByHash(false);
		await processAndWait(setup);
		assertIntentIncluded(
			getLatestEmissionForIntent(setup, intentId)!,
			'Success',
		);
	});

	it('alwaysFetchReceipt: still reports InMemPool for a genuinely pending tx (no receipt yet)', async () => {
		setup = createTestSetup({finality: 12, alwaysFetchReceipt: true});
		const {intentId, addToMempool} = addSingleTxIntent(setup, {nonce: 5});

		// In the mempool, not mined: getTransactionReceipt returns null.
		addToMempool();
		await processAndWait(setup);

		assertIntentInclusion(
			getLatestEmissionForIntent(setup, intentId)!,
			'InMemPool',
		);
	});
});
