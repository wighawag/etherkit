import {describe, it, expect, beforeEach, vi} from 'vitest';
import {createBurnerWalletProvider} from '../src/provider.js';
import {
	ACCOUNT_COUNT,
	type CreateBurnerWalletProviderOptions,
	type Hex,
} from '../src/types.js';

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
	getItem: vi.fn((key: string) => store[key] ?? null),
	setItem: vi.fn((key: string, value: string) => {
		store[key] = value;
	}),
	removeItem: vi.fn((key: string) => {
		delete store[key];
	}),
	clear: vi.fn(),
	length: 0,
	key: vi.fn(() => null),
};

Object.defineProperty(globalThis, 'localStorage', {
	value: localStorageMock,
	writable: true,
});

const TEST_MNEMONIC =
	'test test test test test test test test test test test junk';

/**
 * A CHAIN THAT LIVES IN THE SAME TAB, shaped exactly as webevm's is: one async
 * `request`, no events, `params` typed `unknown`. Kept deliberately loose so
 * this test fails if `nodeURL` is ever narrowed to something a real in-browser
 * node cannot satisfy.
 */
function createFakeNode(chainId = '0x7a69') {
	const calls: {method: string; params?: unknown}[] = [];
	const node = {
		request(args: {method: string; params?: unknown}): Promise<unknown> {
			calls.push({method: args.method, params: args.params});
			switch (args.method) {
				case 'eth_chainId':
					return Promise.resolve(chainId);
				case 'eth_getBalance':
					return Promise.resolve('0x2a');
				default:
					return Promise.reject(
						Object.assign(new Error(`Method not found: ${args.method}`), {
							code: -32601,
						}),
					);
			}
		},
	};
	return {node, calls};
}

describe('nodeURL accepts an EIP-1193 node object', () => {
	beforeEach(() => {
		for (const key of Object.keys(store)) {
			delete store[key];
		}
		vi.clearAllMocks();
	});

	/**
	 * THE ACCEPTANCE CRITERION, AS A TYPE. This assignment is the test: if
	 * `nodeURL` regresses to `string`, or is widened to something a bare
	 * `{request}` node does not structurally satisfy (`EIP1193Provider` from
	 * `eip-1193` is such a type - it is an intersection of per-method overloads
	 * plus event methods), this file stops compiling and `pnpm typecheck` fails.
	 *
	 * No `as`, no `satisfies` escape hatch: a cast here would hide exactly the
	 * bug this guards.
	 */
	it('takes a bare {request} node with no cast', async () => {
		const {node, calls} = createFakeNode();

		const options: CreateBurnerWalletProviderOptions = {nodeURL: node};
		const {provider} = createBurnerWalletProvider(options);

		const chainId = await provider.request({method: 'eth_chainId'});
		expect(chainId).toBe('0x7a69');
		expect(calls.map((c) => c.method)).toContain('eth_chainId');
	});

	it('routes reads to the node object rather than the network', async () => {
		const {node, calls} = createFakeNode();
		const {provider, walletManager} = createBurnerWalletProvider({
			nodeURL: node,
		});
		walletManager.importMnemonic(TEST_MNEMONIC);

		const [account] = (await provider.request({
			method: 'eth_requestAccounts',
		})) as Hex[];

		const balance = await provider.request({
			method: 'eth_getBalance',
			params: [account, 'latest'],
		} as never);

		expect(balance).toBe('0x2a');
		const balanceCall = calls.find((c) => c.method === 'eth_getBalance');
		expect(balanceCall).toBeDefined();
		expect((balanceCall!.params as unknown[])[0]).toBe(account);
	});

	it('signs locally: accounts come from the wallet, not the node', async () => {
		// The node answers `eth_accounts` with -32601, as webevm does. If the
		// burner ever forwarded account methods to the node this would reject.
		const {node, calls} = createFakeNode();
		const {provider} = createBurnerWalletProvider({nodeURL: node});

		const accounts = (await provider.request({
			method: 'eth_accounts',
		})) as Hex[];

		expect(accounts.length).toBe(ACCOUNT_COUNT);
		expect(calls.some((c) => c.method === 'eth_accounts')).toBe(false);
	});

	it('still accepts a URL string (unchanged for every current caller)', async () => {
		const options: CreateBurnerWalletProviderOptions = {
			nodeURL: 'http://localhost:8545',
		};
		const {provider} = createBurnerWalletProvider(options);
		const accounts = (await provider.request({
			method: 'eth_requestAccounts',
		})) as Hex[];
		expect(accounts).toHaveLength(ACCOUNT_COUNT);
	});
});

describe('accountCount', () => {
	beforeEach(() => {
		for (const key of Object.keys(store)) {
			delete store[key];
		}
		vi.clearAllMocks();
	});

	async function accountsWith(
		accountCount?: number,
		mnemonic = TEST_MNEMONIC,
	): Promise<Hex[]> {
		const {node} = createFakeNode();
		const {provider, walletManager} = createBurnerWalletProvider({
			nodeURL: node,
			...(accountCount === undefined ? {} : {accountCount}),
		});
		walletManager.importMnemonic(mnemonic);
		return (await provider.request({method: 'eth_requestAccounts'})) as Hex[];
	}

	it('defaults to ACCOUNT_COUNT when omitted', async () => {
		expect(await accountsWith()).toHaveLength(ACCOUNT_COUNT);
	});

	it('derives exactly one account when asked for one', async () => {
		// The point of the option: one account means a connecting app has no
		// account picker to show.
		const accounts = await accountsWith(1);
		expect(accounts).toHaveLength(1);
	});

	it('is a bound on derivation, not different derivation', async () => {
		// The accounts a caller asking for three gets are the FIRST three a
		// caller asking for ten gets - same mnemonic, same BIP-44 indices. A
		// caller who lowers the count keeps the account they were using.
		const ten = await accountsWith(ACCOUNT_COUNT);
		const three = await accountsWith(3);
		expect(three).toEqual(ten.slice(0, 3));
	});

	it('accepts a count above the default', async () => {
		expect(await accountsWith(12)).toHaveLength(12);
	});

	it.each([0, -1, 1.5, NaN, Infinity])(
		'rejects %p at creation rather than at the first request',
		(bad) => {
			const {node} = createFakeNode();
			expect(() =>
				createBurnerWalletProvider({nodeURL: node, accountCount: bad}),
			).toThrow(/accountCount/);
		},
	);

	it('keeps the count across createNew, importMnemonic and clearAll', async () => {
		const {node} = createFakeNode();
		const {provider, walletManager} = createBurnerWalletProvider({
			nodeURL: node,
			accountCount: 1,
		});

		walletManager.createNew();
		expect(
			await provider.request({method: 'eth_requestAccounts'}),
		).toHaveLength(1);

		walletManager.importMnemonic(TEST_MNEMONIC);
		expect(
			await provider.request({method: 'eth_requestAccounts'}),
		).toHaveLength(1);

		// clearAll drops the mnemonic; the next request auto-creates a wallet,
		// which must still honour the count rather than falling back to ten.
		walletManager.clearAll();
		expect(
			await provider.request({method: 'eth_requestAccounts'}),
		).toHaveLength(1);
	});

	it('single account still signs', async () => {
		const {node} = createFakeNode();
		const {provider, walletManager} = createBurnerWalletProvider({
			nodeURL: node,
			accountCount: 1,
		});
		walletManager.importMnemonic(TEST_MNEMONIC);

		const [account] = (await provider.request({
			method: 'eth_requestAccounts',
		})) as Hex[];
		const signature = (await provider.request({
			method: 'personal_sign',
			params: ['0xdeadbeef', account],
		} as never)) as Hex;

		expect(signature).toMatch(/^0x[0-9a-fA-F]{130}$/);
	});
});

/**
 * THE `removeListener is not a function` GUARD.
 *
 * `EthereumWalletProvider` in `@etherplay/wallet-connector-ethereum` calls `on`
 * and `removeListener` as well as `request`, to follow account and chain
 * changes. A consumer that hides accounts by wrapping the provider in a
 * `{request}`-only object therefore breaks - and breaks LATE: the throw comes
 * from inside the connection, as a failed transaction, after the send is
 * already signed. That cost a debugging session, so it is written down twice:
 * as the type of the returned provider, and here.
 */
describe('the provider a connector is handed', () => {
	beforeEach(() => {
		for (const key of Object.keys(store)) {
			delete store[key];
		}
		vi.clearAllMocks();
	});

	/** The part of a connector's expectations that is not `request`. */
	type ConnectorProvider = {
		request(args: {method: string; params?: unknown}): Promise<unknown>;
		on(event: string, listener: (...args: any[]) => void): unknown;
		removeListener(event: string, listener: (...args: any[]) => void): unknown;
	};

	function subscribeLikeAConnector(p: ConnectorProvider): () => void {
		const onAccounts = () => {};
		p.on('accountsChanged', onAccounts);
		return () => p.removeListener('accountsChanged', onAccounts);
	}

	it('satisfies a connector that calls on/removeListener, not just request', async () => {
		const {node} = createFakeNode();
		const {provider} = createBurnerWalletProvider({
			nodeURL: node,
			accountCount: 1,
		});

		// Compile-time: `EIP1193Provider` is assignable to the connector's
		// expectations. Runtime: subscribing and unsubscribing both work.
		const unsubscribe = subscribeLikeAConnector(provider);
		expect(() => unsubscribe()).not.toThrow();
	});

	it('is why accountCount exists: a {request}-only wrapper would throw', () => {
		const {node} = createFakeNode();
		const {provider} = createBurnerWalletProvider({nodeURL: node});

		// The shape a caller reaches for when they want to hide accounts without
		// this package's help. It answers `request` and nothing else.
		const requestOnly = {
			request: (args: {method: string; params?: unknown}) =>
				(provider as unknown as ConnectorProvider).request(args),
		};

		expect(() =>
			subscribeLikeAConnector(requestOnly as unknown as ConnectorProvider),
		).toThrow(TypeError);
	});
});

describe('chain switching on a wallet bound to one node', () => {
	beforeEach(() => {
		for (const key of Object.keys(store)) {
			delete store[key];
		}
		vi.clearAllMocks();
	});

	it('answers wallet_switchEthereumChain with null for the node chain, without asking the node to switch', async () => {
		const {node, calls} = createFakeNode('0x7a69');
		const {provider} = createBurnerWalletProvider({nodeURL: node});
		const result = await provider.request({
			method: 'wallet_switchEthereumChain',
			params: [{chainId: '0x7A69'}],
		});
		expect(result).toBeNull();
		expect(calls.some((c) => c.method.startsWith('wallet_'))).toBe(false);
	});

	it('refuses another chain with 4902, so an app can tell it from a broken wallet', async () => {
		const {node} = createFakeNode('0x7a69');
		const {provider} = createBurnerWalletProvider({nodeURL: node});
		await expect(
			provider.request({
				method: 'wallet_switchEthereumChain',
				params: [{chainId: '0x1'}],
			}),
		).rejects.toMatchObject({code: 4902});
	});

	it('answers wallet_addEthereumChain with null for its own chain and 4200 for any other', async () => {
		const {node, calls} = createFakeNode('0x7a69');
		const {provider} = createBurnerWalletProvider({nodeURL: node});
		const chain = {
			chainName: 'x',
			nativeCurrency: {name: 'ETH', symbol: 'ETH', decimals: 18},
			rpcUrls: ['http://localhost:8545'],
		};
		await expect(
			provider.request({
				method: 'wallet_addEthereumChain',
				params: [{...chain, chainId: '0x7a69'}],
			}),
		).resolves.toBeNull();
		await expect(
			provider.request({
				method: 'wallet_addEthereumChain',
				params: [{...chain, chainId: '0x1'}],
			}),
		).rejects.toMatchObject({code: 4200});
		expect(calls.some((c) => c.method.startsWith('wallet_'))).toBe(false);
	});
});
