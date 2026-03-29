import {describe, it, expect, beforeEach, vi} from 'vitest';
import {createBurnerWalletProvider} from '../src/provider.js';
import {createBurnerWalletStore} from '../src/store.js';

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

describe('createBurnerWalletProvider', () => {
	beforeEach(() => {
		for (const key of Object.keys(store)) {
			delete store[key];
		}
		vi.clearAllMocks();
	});

	it('returns a provider with standard methods', () => {
		const walletStore = createBurnerWalletStore();
		const provider = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
			store: walletStore,
		});
		expect(provider).toBeDefined();
		expect(provider.request).toBeTypeOf('function');
		expect(provider.on).toBeTypeOf('function');
		expect(provider.removeListener).toBeTypeOf('function');
	});

	it('eth_requestAccounts creates account if none exist', async () => {
		const walletStore = createBurnerWalletStore();
		const provider = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
			store: walletStore,
		});
		expect(walletStore.get().accountCount).toBe(0);

		const accounts = await provider.request({
			method: 'eth_requestAccounts',
		});
		expect(accounts).toHaveLength(1);
		expect((accounts as string[])[0]).toMatch(/^0x[0-9a-fA-F]{40}$/);
		expect(walletStore.get().accountCount).toBe(1);
	});

	it('eth_requestAccounts does not create extra accounts if one exists', async () => {
		const walletStore = createBurnerWalletStore();
		walletStore.createWallet();
		const provider = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
			store: walletStore,
		});

		const accounts = await provider.request({
			method: 'eth_requestAccounts',
		});
		expect(accounts).toHaveLength(1);
		expect(walletStore.get().accountCount).toBe(1);
	});

	it('emits accountsChanged when eth_requestAccounts creates account', async () => {
		const walletStore = createBurnerWalletStore();
		const provider = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
			store: walletStore,
		});

		const listener = vi.fn();
		provider.on('accountsChanged', listener);

		await provider.request({method: 'eth_requestAccounts'});

		// The subscribe mechanism causes an initial emit, plus the creation emit
		expect(listener).toHaveBeenCalled();
		expect(listener).toHaveBeenCalledWith(
			expect.arrayContaining([expect.stringMatching(/^0x/)])
		);
	});

	it('emits accountsChanged when store changes', async () => {
		const walletStore = createBurnerWalletStore();
		walletStore.createWallet();
		const provider = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
			store: walletStore,
		});

		const listener = vi.fn();
		provider.on('accountsChanged', listener);
		listener.mockClear();

		walletStore.addAccount();

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(
			expect.arrayContaining([expect.stringMatching(/^0x/)])
		);
	});

	it('on returns the provider for chaining', () => {
		const walletStore = createBurnerWalletStore();
		const provider = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
			store: walletStore,
		});
		const result = provider.on('accountsChanged', () => {});
		expect(result).toBe(provider);
	});

	it('removeListener stops notifications', async () => {
		const walletStore = createBurnerWalletStore();
		const provider = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
			store: walletStore,
		});

		const listener = vi.fn();
		provider.on('accountsChanged', listener);
		provider.removeListener('accountsChanged', listener);

		await provider.request({method: 'eth_requestAccounts'});

		expect(listener).not.toHaveBeenCalled();
	});

	it('reflects multiple accounts from store', async () => {
		const walletStore = createBurnerWalletStore();
		walletStore.createWallet();
		walletStore.addAccount();
		walletStore.addAccount();

		const provider = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
			store: walletStore,
		});

		const accounts = await provider.request({
			method: 'eth_requestAccounts',
		});
		expect(accounts).toHaveLength(3);
	});
});
