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
		const {provider} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
			store: walletStore,
		});
		expect(provider).toBeDefined();
		expect(provider.request).toBeTypeOf('function');
		expect(provider.on).toBeTypeOf('function');
		expect(provider.removeListener).toBeTypeOf('function');
	});

	it('returns cleanup function', () => {
		const walletStore = createBurnerWalletStore();
		const {cleanup} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
			store: walletStore,
		});
		expect(cleanup).toBeTypeOf('function');
	});

	it('cleanup unsubscribes from store', () => {
		const walletStore = createBurnerWalletStore();
		walletStore.createWallet();
		const {provider, cleanup} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
			store: walletStore,
		});

		const listener = vi.fn();
		provider.on('accountsChanged', listener);
		listener.mockClear();

		// Cleanup should unsubscribe from store
		cleanup();

		// Adding account should NOT emit accountsChanged after cleanup
		walletStore.addAccount();
		expect(listener).not.toHaveBeenCalled();
	});

	it('eth_requestAccounts creates account if none exist', async () => {
		const walletStore = createBurnerWalletStore();
		const {provider} = createBurnerWalletProvider({
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
		const {provider} = createBurnerWalletProvider({
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
		const {provider} = createBurnerWalletProvider({
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
		const {provider} = createBurnerWalletProvider({
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
		const {provider} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
			store: walletStore,
		});
		const result = provider.on('accountsChanged', () => {});
		expect(result).toBe(provider);
	});

	it('removeListener stops notifications', async () => {
		const walletStore = createBurnerWalletStore();
		const {provider} = createBurnerWalletProvider({
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

		const {provider} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
			store: walletStore,
		});

		const accounts = await provider.request({
			method: 'eth_requestAccounts',
		});
		expect(accounts).toHaveLength(3);
	});

	it('auto-creates wallet after clearAll', async () => {
		const walletStore = createBurnerWalletStore();
		walletStore.createWallet();
		const originalAddress = walletStore.get().addresses[0];

		const {provider} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
			store: walletStore,
		});

		// Clear all data
		walletStore.clearAll();
		expect(walletStore.get().accountCount).toBe(0);
		expect(walletStore.get().addresses).toEqual([]);

		// eth_requestAccounts should auto-create a new wallet
		const accounts = await provider.request({
			method: 'eth_requestAccounts',
		});

		expect(accounts).toHaveLength(1);
		expect((accounts as string[])[0]).toMatch(/^0x[0-9a-fA-F]{40}$/);
		expect(walletStore.get().accountCount).toBe(1);
		// New mnemonic should generate different address
		expect((accounts as string[])[0]).not.toBe(originalAddress);
	});

	it('returns selected address first in eth_requestAccounts', async () => {
		const walletStore = createBurnerWalletStore();
		walletStore.createWallet();
		walletStore.addAccount();
		walletStore.addAccount();

		const {provider} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
			store: walletStore,
		});

		// Select the second account (index 1)
		walletStore.selectAccount(1);

		const accounts = await provider.request({
			method: 'eth_requestAccounts',
		});

		// The selected account should be first
		expect(accounts).toHaveLength(3);
		expect((accounts as string[])[0]).toBe(
			walletStore.get().selectedAddress
		);
	});

	it('emits accountsChanged when selected account changes', async () => {
		const walletStore = createBurnerWalletStore();
		walletStore.createWallet();
		walletStore.addAccount();
		walletStore.addAccount();
		// addAccount auto-selects the new account, so selectedIndex is now 2
		// Reset to account 0 to establish baseline
		walletStore.selectAccount(0);

		const {provider} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
			store: walletStore,
		});

		const listener = vi.fn();
		provider.on('accountsChanged', listener);
		listener.mockClear();

		// Change selected account from 0 to 2
		walletStore.selectAccount(2);

		expect(listener).toHaveBeenCalledTimes(1);
		// First account in the emitted array should be the selected one
		const emittedAccounts = listener.mock.calls[0][0] as string[];
		expect(emittedAccounts[0]).toBe(walletStore.get().selectedAddress);
	});
});
