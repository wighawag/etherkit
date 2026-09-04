/**
 * The observer talks to whatever the user's wallet injected. A provider that
 * answers something unusable must degrade into "we do not know", never into a
 * confident wrong answer or an endless write loop.
 */
import {describe, it, expect, beforeEach} from 'vitest';
import {
	createTransactionObserver,
	type TransactionIntentEvent,
} from '../../src/index.js';
import {
	createMockProvider,
	type MockProviderConfig,
} from '../mocks/MockEIP1193Provider.js';
import {
	createBroadcastedTx,
	createMockTx,
	resetHashCounter,
	TEST_ACCOUNT,
} from '../fixtures/transactions.js';
import {createIntent, resetIntentIdCounter} from '../fixtures/intents.js';

type Request = (args: {method: string; params?: unknown[]}) => Promise<unknown>;

/**
 * Wrap a mock provider, overriding some methods (or making them throw).
 */
function quirky(
	config: MockProviderConfig,
	overrides: {
		[method: string]: (params: unknown[], answer: unknown) => unknown;
	},
) {
	const {provider, controller} = createMockProvider(config);
	const calls: string[] = [];
	const request: Request = async (args) => {
		calls.push(args.method);
		const override = overrides[args.method];
		if (override) {
			let answer: unknown;
			try {
				answer = await provider.request(args as never);
			} catch {
				answer = undefined;
			}
			return override(args.params ?? [], answer);
		}
		return provider.request(args as never);
	};
	return {
		provider: {request, on: () => {}, removeListener: () => {}} as never,
		controller,
		calls,
	};
}

describe('Provider quirks', () => {
	beforeEach(() => {
		resetHashCounter();
		resetIntentIdCounter();
	});

	it('ignores an unusable chainId instead of calling every intent foreign', async () => {
		const {provider, controller} = quirky(
			{},
			{eth_chainId: () => 'not-a-chain-id'},
		);
		const observer = createTransactionObserver({finality: 12, provider});
		const stateEvents: TransactionIntentEvent[] = [];
		observer.on('intent:state', (event) => stateEvents.push(event));

		// This transaction IS on the provider's chain, but the provider cannot
		// say so. Number('not-a-chain-id') is NaN, which matches nothing: an
		// unvalidated answer would strand every intent that carries a chainId.
		const tx = createBroadcastedTx({nonce: 0, from: TEST_ACCOUNT, chainId: 1});
		observer.add('tagged', createIntent({transactions: [tx]}));
		controller.addToMempool(
			createMockTx({hash: tx.hash, from: tx.from, nonce: 0}),
		);

		await observer.process();

		expect(stateEvents.length).toBe(1);
		expect(stateEvents[0].intent.state?.inclusion).toBe('InMemPool');
	});

	it('asks for the chain id once, not once per tick, when the provider cannot answer', async () => {
		const {provider, controller, calls} = quirky(
			{},
			{
				eth_chainId: () => {
					throw new Error('unsupported method');
				},
			},
		);
		const observer = createTransactionObserver({finality: 12, provider});

		const tx = createBroadcastedTx({nonce: 0, from: TEST_ACCOUNT});
		observer.add('untagged', createIntent({transactions: [tx]}));
		controller.addToMempool(
			createMockTx({hash: tx.hash, from: tx.from, nonce: 0}),
		);

		await observer.process();
		await observer.process();
		await observer.process();

		expect(calls.filter((method) => method === 'eth_chainId').length).toBe(1);
		// and the ticks still did their work
		expect(
			calls.filter((method) => method === 'eth_getTransactionByHash').length,
		).toBe(3);
	});

	it('ignores an unusable nonce instead of rewriting the transaction every tick', async () => {
		const {provider, controller} = quirky(
			{},
			{
				eth_getTransactionByHash: (_params, answer) =>
					answer ? {...(answer as object), nonce: undefined} : answer,
			},
		);
		const observer = createTransactionObserver({finality: 12, provider});
		const updates: TransactionIntentEvent[] = [];
		observer.on('intent:updated', (event) => updates.push(event));

		const tx = createBroadcastedTx({nonce: 5, from: TEST_ACCOUNT});
		observer.add('bad-nonce', createIntent({transactions: [tx]}));
		controller.addToMempool(
			createMockTx({hash: tx.hash, from: tx.from, nonce: 5}),
		);

		await observer.process();
		await observer.process();
		await observer.process();

		// One emission for becoming InMemPool, and nothing after: Number(undefined)
		// is NaN, which never equals itself, so an unguarded assignment would
		// rewrite the transaction (and hit the consumer's storage) every tick.
		expect(updates.length).toBe(1);
		const stored = updates[0].intent.transactions[0];
		expect(stored.nonce).toBe(5); // the intended nonce, untouched
		expect(stored.nonceObserved).toBeUndefined(); // and still unproven
	});

	it('does not window a new intent with a block number from the previous chain', async () => {
		const {provider: providerA, controller: controllerA} = createMockProvider({
			initialBlockNumber: 100,
		});
		const {provider: providerB} = createMockProvider({
			initialBlockNumber: 500,
		});
		const observer = createTransactionObserver({
			finality: 12,
			provider: providerA,
		});
		const updates: TransactionIntentEvent[] = [];
		observer.on('intent:updated', (event) => updates.push(event));

		// Learn chain A's height.
		const tx = createBroadcastedTx({nonce: 0, from: TEST_ACCOUNT});
		observer.add('on-a', createIntent({transactions: [tx]}));
		controllerA.addToMempool(
			createMockTx({hash: tx.hash, from: tx.from, nonce: 0}),
		);
		await observer.process();

		// The user switches network. Block 100 means nothing on chain B.
		observer.setProvider(
			providerB as unknown as Parameters<typeof observer.setProvider>[0],
		);
		observer.add(
			'on-b',
			createIntent({
				transactions: [createBroadcastedTx({nonce: 0, from: TEST_ACCOUNT})],
				expectedUpdate: {
					address: '0xcccccccccccccccccccccccccccccccccccccccc',
					event: {topics: []},
				},
			}),
		);

		await observer.process();

		const windowed = updates.filter((event) => event.id === 'on-b');
		expect(windowed.length).toBeGreaterThan(0);
		expect(windowed[0].intent.expectedUpdate?.fromBlock).toBe(500);
	});
});
