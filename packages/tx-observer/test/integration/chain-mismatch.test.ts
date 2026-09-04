/**
 * `chainId` on a transaction is a claim about which chain it lives on. When it
 * contradicts the provider, the intent cannot be resolved here: the hash is
 * unknown to this node and the sender's nonce means something else entirely.
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

// The mock provider answers eth_chainId with 0x1.
const MOCK_CHAIN_ID = 1;

describe('Chain id mismatch', () => {
	beforeEach(() => {
		resetHashCounter();
		resetIntentIdCounter();
	});

	it('skips an intent whose transaction is from another chain', async () => {
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});

		const events: TransactionIntentEvent[] = [];
		observer.on('intent:updated', (event) => events.push(event));
		observer.on('intent:state', (event) => events.push(event));

		const foreignTx = createBroadcastedTx({
			nonce: 0,
			from: TEST_ACCOUNT,
			chainId: 999,
		});
		observer.add('foreign', createIntent({transactions: [foreignTx]}));

		// Same hash exists on this chain's mock, so nothing but the chainId check
		// can keep the observer from reporting a state for it.
		controller.addToMempool(
			createMockTx({hash: foreignTx.hash, from: foreignTx.from, nonce: 0}),
		);

		await observer.process();

		expect(events.filter((event) => event.id === 'foreign').length).toBe(0);
	});

	it('stops asking the chain anything at all once the mismatch is known', async () => {
		// The "warn once" itself is not observable from outside (named-logs is a
		// no-op unless the host app hooks it), but its point is that a skipped
		// intent costs nothing per tick. That IS observable: no RPC at all.
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});

		const calls: string[] = [];
		controller.onRequest((method) => {
			calls.push(method);
		});

		const foreignTx = createBroadcastedTx({
			nonce: 0,
			from: TEST_ACCOUNT,
			chainId: 999,
		});
		observer.add('foreign', createIntent({transactions: [foreignTx]}));
		controller.addToMempool(
			createMockTx({hash: foreignTx.hash, from: foreignTx.from, nonce: 0}),
		);

		// First tick learns the chain id and skips the intent.
		await observer.process();
		expect(calls).toContain('eth_chainId');
		const callsAfterFirstTick = calls.length;

		// Once the chain is known, an observer holding only foreign intents has
		// nothing to ask: not even the two head-block requests.
		await observer.process();
		await observer.process();
		expect(calls.length).toBe(callsAfterFirstTick);
	});

	it('processes an intent whose transaction is on the provider chain', async () => {
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});

		const stateEvents: TransactionIntentEvent[] = [];
		observer.on('intent:state', (event) => stateEvents.push(event));

		const localTx = createBroadcastedTx({
			nonce: 0,
			from: TEST_ACCOUNT,
			chainId: MOCK_CHAIN_ID,
		});
		observer.add('local', createIntent({transactions: [localTx]}));
		controller.addToMempool(
			createMockTx({hash: localTx.hash, from: localTx.from, nonce: 0}),
		);

		await observer.process();

		expect(stateEvents.length).toBe(1);
		expect(stateEvents[0].intent.state?.inclusion).toBe('InMemPool');
	});

	it('re-reads the chain when the provider is replaced', async () => {
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});

		const stateEvents: TransactionIntentEvent[] = [];
		observer.on('intent:state', (event) => stateEvents.push(event));

		// The user's wallet is on chain 5; this transaction belongs there.
		const tx = createBroadcastedTx({nonce: 0, from: TEST_ACCOUNT, chainId: 5});
		observer.add('elsewhere', createIntent({transactions: [tx]}));
		controller.addToMempool(
			createMockTx({hash: tx.hash, from: tx.from, nonce: 0}),
		);

		await observer.process();
		expect(stateEvents.length).toBe(0);

		// Same chain data, but the provider now reports chain 5: the cached chain
		// id must be refreshed by setProvider, not kept from the previous one.
		const onChain5 = {
			...provider,
			request: (args: {method: string; params?: unknown[]}) =>
				args.method === 'eth_chainId'
					? Promise.resolve('0x5')
					: provider.request(args as never),
			on: () => {},
			removeListener: () => {},
		} as unknown as Parameters<typeof observer.setProvider>[0];
		observer.setProvider(onChain5);

		await observer.process();
		expect(stateEvents.length).toBe(1);
		expect(stateEvents[0].intent.state?.inclusion).toBe('InMemPool');
	});

	it('discards a tick that started against the previous provider', async () => {
		// A tick reads the chain over several round trips. If the provider is
		// swapped halfway through (the user switches network), the answers from
		// the old chain must not be written into the intents: the transaction
		// they describe does not exist on the new one. The chainId check cannot
		// help here, since most stored transactions carry no chainId at all.
		const {provider: providerA, controller: controllerA} = createMockProvider();
		const {provider: providerB} = createMockProvider();
		const observer = createTransactionObserver({
			finality: 12,
			provider: providerA,
		});

		const events: TransactionIntentEvent[] = [];
		observer.on('intent:state', (event) => events.push(event));
		observer.on('intent:updated', (event) => events.push(event));

		const tx = createBroadcastedTx({nonce: 0, from: TEST_ACCOUNT});
		observer.add('mid-swap', createIntent({transactions: [tx]}));
		controllerA.addToMempool(
			createMockTx({hash: tx.hash, from: tx.from, nonce: 0}),
		);

		const unhook = controllerA.onRequest((method) => {
			if (method === 'eth_getTransactionByHash') {
				observer.setProvider(
					providerB as unknown as Parameters<typeof observer.setProvider>[0],
				);
			}
		});

		await observer.process();
		unhook();

		// Nothing learned on chain A may be written or emitted.
		expect(events.length).toBe(0);
	});

	it('skips only the foreign intent, not its neighbours', async () => {
		const {provider, controller} = createMockProvider();
		const observer = createTransactionObserver({finality: 12, provider});

		const stateEvents: TransactionIntentEvent[] = [];
		observer.on('intent:state', (event) => stateEvents.push(event));

		const foreignTx = createBroadcastedTx({
			nonce: 0,
			from: TEST_ACCOUNT,
			chainId: 999,
		});
		const localTx = createBroadcastedTx({
			nonce: 0,
			from: TEST_ACCOUNT_2,
		});
		observer.add('foreign', createIntent({transactions: [foreignTx]}));
		observer.add('local', createIntent({transactions: [localTx]}));
		controller.addToMempool(
			createMockTx({hash: localTx.hash, from: localTx.from, nonce: 0}),
		);

		await observer.process();

		expect(stateEvents.map((event) => event.id)).toEqual(['local']);
	});
});
