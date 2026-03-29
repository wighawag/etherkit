import {describe, it, expect, beforeEach, vi} from 'vitest';
import {createBurnerWalletProvider} from '../src/provider.js';
import {ACCOUNT_COUNT} from '../src/types.js';

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
		const {provider} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});
		expect(provider).toBeDefined();
		expect(provider.request).toBeTypeOf('function');
		expect(provider.on).toBeTypeOf('function');
		expect(provider.removeListener).toBeTypeOf('function');
	});

	it('returns walletManager with expected methods', () => {
		const {walletManager} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});
		expect(walletManager).toBeDefined();
		expect(walletManager.createNew).toBeTypeOf('function');
		expect(walletManager.importMnemonic).toBeTypeOf('function');
		expect(walletManager.selectAccount).toBeTypeOf('function');
		expect(walletManager.clearAll).toBeTypeOf('function');
		expect(walletManager.get).toBeTypeOf('function');
	});

	it('returns cleanup function', () => {
		const {cleanup} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});
		expect(cleanup).toBeTypeOf('function');
	});

	it('cleanup clears event listeners', () => {
		const {provider, walletManager, cleanup} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});
		walletManager.createNew();

		const listener = vi.fn();
		provider.on('accountsChanged', listener);
		listener.mockClear();

		// Cleanup should clear event listeners
		cleanup();

		// Changing selection should NOT emit accountsChanged after cleanup
		walletManager.selectAccount(1);
		expect(listener).not.toHaveBeenCalled();
	});

	it('eth_requestAccounts creates wallet if none exist', async () => {
		const {provider, walletManager} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});
		expect(walletManager.get().mnemonic).toBeNull();

		const accounts = await provider.request({
			method: 'eth_requestAccounts',
		});
		expect(accounts).toHaveLength(ACCOUNT_COUNT);
		expect((accounts as string[])[0]).toMatch(/^0x[0-9a-fA-F]{40}$/);
		expect(walletManager.get().mnemonic).not.toBeNull();
	});

	it('eth_requestAccounts does not create new wallet if one exists', async () => {
		const {provider, walletManager} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});
		const mnemonic = walletManager.createNew();

		const accounts = await provider.request({
			method: 'eth_requestAccounts',
		});
		expect(accounts).toHaveLength(ACCOUNT_COUNT);
		expect(walletManager.get().mnemonic).toBe(mnemonic);
	});

	it('emits accountsChanged when eth_requestAccounts creates wallet', async () => {
		const {provider} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});

		const listener = vi.fn();
		provider.on('accountsChanged', listener);

		await provider.request({method: 'eth_requestAccounts'});

		expect(listener).toHaveBeenCalled();
		expect(listener).toHaveBeenCalledWith(
			expect.arrayContaining([expect.stringMatching(/^0x/)]),
		);
	});

	it('emits accountsChanged when walletManager creates new wallet', async () => {
		const {provider, walletManager} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});

		const listener = vi.fn();
		provider.on('accountsChanged', listener);

		walletManager.createNew();

		// Wait for async event emission
		await vi.waitFor(() => expect(listener).toHaveBeenCalled());
		expect(listener).toHaveBeenCalledWith(
			expect.arrayContaining([expect.stringMatching(/^0x/)]),
		);
	});

	it('on returns the provider for chaining', () => {
		const {provider} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});
		const result = provider.on('accountsChanged', () => {});
		expect(result).toBe(provider);
	});

	it('removeListener stops notifications', async () => {
		const {provider} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});

		const listener = vi.fn();
		provider.on('accountsChanged', listener);
		provider.removeListener('accountsChanged', listener);

		await provider.request({method: 'eth_requestAccounts'});

		expect(listener).not.toHaveBeenCalled();
	});

	it('returns 10 accounts (fixed account count)', async () => {
		const {provider, walletManager} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});
		walletManager.createNew();

		const accounts = await provider.request({
			method: 'eth_requestAccounts',
		});
		expect(accounts).toHaveLength(10);
	});

	it('auto-creates wallet after clearAll', async () => {
		const {provider, walletManager} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});
		const originalMnemonic = walletManager.createNew();

		// Clear all data
		walletManager.clearAll();
		expect(walletManager.get().mnemonic).toBeNull();

		// eth_requestAccounts should auto-create a new wallet
		const accounts = await provider.request({
			method: 'eth_requestAccounts',
		});

		expect(accounts).toHaveLength(ACCOUNT_COUNT);
		expect((accounts as string[])[0]).toMatch(/^0x[0-9a-fA-F]{40}$/);
		// New mnemonic should be different
		expect(walletManager.get().mnemonic).not.toBe(originalMnemonic);
	});

	it('returns selected address first in eth_requestAccounts', async () => {
		const {provider, walletManager} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});
		walletManager.createNew();

		// Get all accounts first to know the addresses
		const allAccounts = (await provider.request({
			method: 'eth_accounts',
		})) as string[];

		// Select the third account (index 2)
		walletManager.selectAccount(2);

		const accounts = await provider.request({
			method: 'eth_requestAccounts',
		});

		// The selected account (originally at index 2) should be first
		expect(accounts).toHaveLength(ACCOUNT_COUNT);
		expect((accounts as string[])[0]).toBe(allAccounts[2]);
	});

	it('emits accountsChanged when selected account changes', async () => {
		const {provider, walletManager} = createBurnerWalletProvider({
			nodeURL: 'http://localhost:8545',
		});
		walletManager.createNew();

		const listener = vi.fn();
		provider.on('accountsChanged', listener);

		// Wait for the initial createNew event to fire
		await vi.waitFor(() => expect(listener).toHaveBeenCalled());
		listener.mockClear();

		// Change selected account from 0 to 2
		walletManager.selectAccount(2);

		// Wait for async event emission from selectAccount
		await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
		// First account in the emitted array should be the selected one
		const emittedAccounts = listener.mock.calls[0][0] as string[];
		expect(emittedAccounts).toHaveLength(ACCOUNT_COUNT);
	});
});

describe('walletManager', () => {
	beforeEach(() => {
		for (const key of Object.keys(store)) {
			delete store[key];
		}
		vi.clearAllMocks();
	});

	describe('createNew', () => {
		it('generates a 12-word mnemonic', () => {
			const {walletManager} = createBurnerWalletProvider({
				nodeURL: 'http://localhost:8545',
			});
			const mnemonic = walletManager.createNew();
			expect(mnemonic.split(' ')).toHaveLength(12);
		});

		it('sets selectedIndex to 0', () => {
			const {walletManager} = createBurnerWalletProvider({
				nodeURL: 'http://localhost:8545',
			});
			walletManager.createNew();
			const state = walletManager.get();
			expect(state.selectedIndex).toBe(0);
		});

		it('persists mnemonic to localStorage', () => {
			const {walletManager} = createBurnerWalletProvider({
				nodeURL: 'http://localhost:8545',
			});
			walletManager.createNew();
			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'burner-wallet:mnemonic',
				expect.any(String),
			);
			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'burner-wallet:selected',
				'0',
			);
		});
	});

	describe('importMnemonic', () => {
		it('accepts valid mnemonic', () => {
			const {walletManager} = createBurnerWalletProvider({
				nodeURL: 'http://localhost:8545',
			});
			const mnemonic =
				'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
			walletManager.importMnemonic(mnemonic);
			expect(walletManager.get().mnemonic).toBe(mnemonic);
		});

		it('resets selectedIndex to 0', () => {
			const {walletManager} = createBurnerWalletProvider({
				nodeURL: 'http://localhost:8545',
			});
			walletManager.createNew();
			walletManager.selectAccount(5);
			expect(walletManager.get().selectedIndex).toBe(5);

			const mnemonic =
				'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
			walletManager.importMnemonic(mnemonic);
			expect(walletManager.get().selectedIndex).toBe(0);
		});
	});

	describe('selectAccount', () => {
		it('changes selected index', () => {
			const {walletManager} = createBurnerWalletProvider({
				nodeURL: 'http://localhost:8545',
			});
			walletManager.createNew();
			walletManager.selectAccount(5);
			expect(walletManager.get().selectedIndex).toBe(5);
		});

		it('throws for index beyond ACCOUNT_COUNT', () => {
			const {walletManager} = createBurnerWalletProvider({
				nodeURL: 'http://localhost:8545',
			});
			walletManager.createNew();
			expect(() => walletManager.selectAccount(15)).toThrow('Invalid index');
		});

		it('throws for negative index', () => {
			const {walletManager} = createBurnerWalletProvider({
				nodeURL: 'http://localhost:8545',
			});
			walletManager.createNew();
			expect(() => walletManager.selectAccount(-1)).toThrow('Invalid index');
		});

		it('persists to localStorage', () => {
			const {walletManager} = createBurnerWalletProvider({
				nodeURL: 'http://localhost:8545',
			});
			walletManager.createNew();
			localStorageMock.setItem.mockClear();

			walletManager.selectAccount(3);
			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'burner-wallet:selected',
				'3',
			);
		});
	});

	describe('clearAll', () => {
		it('resets all state', () => {
			const {walletManager} = createBurnerWalletProvider({
				nodeURL: 'http://localhost:8545',
			});
			walletManager.createNew();
			walletManager.selectAccount(5);
			walletManager.clearAll();

			const state = walletManager.get();
			expect(state.mnemonic).toBeNull();
			expect(state.selectedIndex).toBe(0);
		});

		it('clears localStorage', () => {
			const {walletManager} = createBurnerWalletProvider({
				nodeURL: 'http://localhost:8545',
			});
			walletManager.createNew();
			walletManager.clearAll();
			expect(localStorageMock.removeItem).toHaveBeenCalledWith(
				'burner-wallet:mnemonic',
			);
		});
	});

	describe('get', () => {
		it('returns current state snapshot', () => {
			const {walletManager} = createBurnerWalletProvider({
				nodeURL: 'http://localhost:8545',
			});
			walletManager.createNew();
			walletManager.selectAccount(3);

			const state = walletManager.get();
			expect(state.selectedIndex).toBe(3);
			expect(state.mnemonic).not.toBeNull();
		});

		it('returns null mnemonic when no wallet', () => {
			const {walletManager} = createBurnerWalletProvider({
				nodeURL: 'http://localhost:8545',
			});
			const state = walletManager.get();
			expect(state.mnemonic).toBeNull();
			expect(state.selectedIndex).toBe(0);
		});
	});

	describe('localStorage persistence', () => {
		it('loads state from localStorage on creation', () => {
			// Set up localStorage
			const mnemonic =
				'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
			store['burner-wallet:mnemonic'] = mnemonic;
			store['burner-wallet:selected'] = '5';

			const {walletManager} = createBurnerWalletProvider({
				nodeURL: 'http://localhost:8545',
			});
			const state = walletManager.get();

			expect(state.mnemonic).toBe(mnemonic);
			expect(state.selectedIndex).toBe(5);
		});

		it('uses custom storage prefix', () => {
			const {walletManager} = createBurnerWalletProvider({
				nodeURL: 'http://localhost:8545',
				storagePrefix: 'custom:',
			});
			walletManager.createNew();

			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'custom:mnemonic',
				expect.any(String),
			);
		});
	});

	describe('address derivation', () => {
		it('derives known addresses from standard test mnemonic', async () => {
			// Set up localStorage with test mnemonic
			const mnemonic =
				'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

			const {provider, walletManager} = createBurnerWalletProvider({
				nodeURL: 'http://localhost:8545',
			});
			walletManager.importMnemonic(mnemonic);

			const accounts = (await provider.request({
				method: 'eth_accounts',
			})) as string[];

			// First account address for this mnemonic (BIP-44 m/44'/60'/0'/0/0)
			// This is a well-known address for this test vector
			expect(accounts[0].toLowerCase()).toBe(
				'0x9858effd232b4033e47d90003d41ec34ecaeda94'.toLowerCase(),
			);
		});
	});
});
