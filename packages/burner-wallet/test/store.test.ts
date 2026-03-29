import {describe, it, expect, beforeEach, vi} from 'vitest';
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
	clear: vi.fn(() => {
		for (const key of Object.keys(store)) {
			delete store[key];
		}
	}),
	length: 0,
	key: vi.fn(() => null),
};

Object.defineProperty(globalThis, 'localStorage', {
	value: localStorageMock,
	writable: true,
});

describe('BurnerWalletStore', () => {
	beforeEach(() => {
		for (const key of Object.keys(store)) {
			delete store[key];
		}
		vi.clearAllMocks();
	});

	describe('createWallet', () => {
		it('generates a 12-word mnemonic', () => {
			const walletStore = createBurnerWalletStore();
			const mnemonic = walletStore.createWallet();
			expect(mnemonic.split(' ')).toHaveLength(12);
		});

		it('creates one account', () => {
			const walletStore = createBurnerWalletStore();
			walletStore.createWallet();
			const state = walletStore.get();
			expect(state.accountCount).toBe(1);
			expect(state.addresses).toHaveLength(1);
			expect(state.selectedIndex).toBe(0);
		});

		it('persists mnemonic to localStorage', () => {
			const walletStore = createBurnerWalletStore();
			walletStore.createWallet();
			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'burner-wallet:mnemonic',
				expect.any(String)
			);
			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'burner-wallet:count',
				'1'
			);
		});
	});

	describe('importMnemonic', () => {
		it('accepts valid mnemonic', () => {
			const walletStore = createBurnerWalletStore();
			const mnemonic =
				'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
			walletStore.importMnemonic(mnemonic);
			expect(walletStore.getMnemonic()).toBe(mnemonic);
		});

		it('resets account count to 1', () => {
			const walletStore = createBurnerWalletStore();
			walletStore.createWallet();
			walletStore.addAccount();
			walletStore.addAccount();
			expect(walletStore.get().accountCount).toBe(3);

			const mnemonic =
				'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
			walletStore.importMnemonic(mnemonic);
			expect(walletStore.get().accountCount).toBe(1);
		});

		it('throws for invalid/garbage mnemonic', () => {
			const walletStore = createBurnerWalletStore();
			expect(() =>
				walletStore.importMnemonic('not a valid mnemonic phrase at all')
			).toThrow();
		});

		it('throws for empty mnemonic', () => {
			const walletStore = createBurnerWalletStore();
			expect(() => walletStore.importMnemonic('')).toThrow();
		});

		it('does not update state when mnemonic is invalid', () => {
			const walletStore = createBurnerWalletStore();
			const originalMnemonic = walletStore.createWallet();

			expect(() =>
				walletStore.importMnemonic('garbage words here')
			).toThrow();

			// Original mnemonic should still be in place
			expect(walletStore.getMnemonic()).toBe(originalMnemonic);
		});
	});

	describe('addAccount', () => {
		it('auto-creates wallet if none exists', () => {
			const walletStore = createBurnerWalletStore();
			expect(walletStore.getMnemonic()).toBeNull();
			walletStore.addAccount();
			expect(walletStore.getMnemonic()).not.toBeNull();
		});

		it('increments account count', () => {
			const walletStore = createBurnerWalletStore();
			walletStore.createWallet();
			expect(walletStore.get().accountCount).toBe(1);
			walletStore.addAccount();
			expect(walletStore.get().accountCount).toBe(2);
			walletStore.addAccount();
			expect(walletStore.get().accountCount).toBe(3);
		});

		it('returns new index', () => {
			const walletStore = createBurnerWalletStore();
			walletStore.createWallet();
			expect(walletStore.addAccount()).toBe(1);
			expect(walletStore.addAccount()).toBe(2);
		});

		it('selects new account', () => {
			const walletStore = createBurnerWalletStore();
			walletStore.createWallet();
			walletStore.addAccount();
			expect(walletStore.get().selectedIndex).toBe(1);
		});
	});

	describe('selectAccount', () => {
		it('auto-creates wallet if none exists', () => {
			const walletStore = createBurnerWalletStore();
			walletStore.selectAccount(0);
			expect(walletStore.getMnemonic()).not.toBeNull();
		});

		it('changes selected index', () => {
			const walletStore = createBurnerWalletStore();
			walletStore.createWallet();
			walletStore.addAccount();
			walletStore.addAccount();
			walletStore.selectAccount(1);
			expect(walletStore.get().selectedIndex).toBe(1);
		});

		it('throws for index beyond account count', () => {
			const walletStore = createBurnerWalletStore();
			walletStore.createWallet();
			expect(() => walletStore.selectAccount(5)).toThrow('Invalid index');
			// Account count should remain unchanged
			expect(walletStore.get().accountCount).toBe(1);
		});

		it('throws for negative index', () => {
			const walletStore = createBurnerWalletStore();
			walletStore.createWallet();
			expect(() => walletStore.selectAccount(-1)).toThrow('Invalid index');
		});
	});

	describe('clearAll', () => {
		it('resets all state', () => {
			const walletStore = createBurnerWalletStore();
			walletStore.createWallet();
			walletStore.addAccount();
			walletStore.clearAll();

			const state = walletStore.get();
			expect(state.mnemonic).toBeNull();
			expect(state.accountCount).toBe(0);
			expect(state.addresses).toEqual([]);
			expect(state.selectedAddress).toBeNull();
		});

		it('clears localStorage', () => {
			const walletStore = createBurnerWalletStore();
			walletStore.createWallet();
			walletStore.clearAll();
			expect(localStorageMock.removeItem).toHaveBeenCalledWith(
				'burner-wallet:mnemonic'
			);
		});
	});

	describe('getMnemonic', () => {
		it('returns null if no wallet', () => {
			const walletStore = createBurnerWalletStore();
			expect(walletStore.getMnemonic()).toBeNull();
		});

		it('returns mnemonic if wallet exists', () => {
			const walletStore = createBurnerWalletStore();
			const mnemonic = walletStore.createWallet();
			expect(walletStore.getMnemonic()).toBe(mnemonic);
		});
	});

	describe('getPrivateKey', () => {
		it('returns valid hex private key', () => {
			const walletStore = createBurnerWalletStore();
			walletStore.createWallet();
			const key = walletStore.getPrivateKey(0);
			expect(key).toMatch(/^0x[0-9a-f]{64}$/);
		});

		it('throws if no wallet', () => {
			const walletStore = createBurnerWalletStore();
			expect(() => walletStore.getPrivateKey(0)).toThrow(
				'No wallet created'
			);
		});

		it('throws if index out of range', () => {
			const walletStore = createBurnerWalletStore();
			walletStore.createWallet();
			expect(() => walletStore.getPrivateKey(1)).toThrow('Invalid index');
		});

		it('derives deterministic keys from mnemonic', () => {
			const mnemonic =
				'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
			const walletStore1 = createBurnerWalletStore({
				storagePrefix: 'test1:',
			});
			walletStore1.importMnemonic(mnemonic);

			const walletStore2 = createBurnerWalletStore({
				storagePrefix: 'test2:',
			});
			walletStore2.importMnemonic(mnemonic);

			expect(walletStore1.getPrivateKey(0)).toBe(
				walletStore2.getPrivateKey(0)
			);
		});
	});

	describe('getPrivateKeys', () => {
		it('returns empty array if no wallet', () => {
			const walletStore = createBurnerWalletStore();
			expect(walletStore.getPrivateKeys()).toEqual([]);
		});

		it('returns all private keys', () => {
			const walletStore = createBurnerWalletStore();
			walletStore.createWallet();
			walletStore.addAccount();
			walletStore.addAccount();
			const keys = walletStore.getPrivateKeys();
			expect(keys).toHaveLength(3);
			keys.forEach((key) => {
				expect(key).toMatch(/^0x[0-9a-f]{64}$/);
			});
		});
	});

	describe('getAddress', () => {
		it('returns valid hex address', () => {
			const walletStore = createBurnerWalletStore();
			walletStore.createWallet();
			const addr = walletStore.getAddress(0);
			expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
		});

		it('throws if no wallet', () => {
			const walletStore = createBurnerWalletStore();
			expect(() => walletStore.getAddress(0)).toThrow('No wallet created');
		});

		it('throws if index out of range', () => {
			const walletStore = createBurnerWalletStore();
			walletStore.createWallet();
			expect(() => walletStore.getAddress(1)).toThrow('Invalid index');
		});
	});

	describe('subscribe', () => {
		it('calls listener immediately with current state', () => {
			const walletStore = createBurnerWalletStore();
			walletStore.createWallet();

			const listener = vi.fn();
			walletStore.subscribe(listener);

			expect(listener).toHaveBeenCalledTimes(1);
			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({
					accountCount: 1,
					selectedIndex: 0,
				})
			);
		});

		it('calls listener on state changes', () => {
			const walletStore = createBurnerWalletStore();
			walletStore.createWallet();

			const listener = vi.fn();
			walletStore.subscribe(listener);
			listener.mockClear();

			walletStore.addAccount();
			expect(listener).toHaveBeenCalledTimes(1);
			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({
					accountCount: 2,
				})
			);
		});

		it('returns unsubscribe function', () => {
			const walletStore = createBurnerWalletStore();
			walletStore.createWallet();

			const listener = vi.fn();
			const unsubscribe = walletStore.subscribe(listener);
			listener.mockClear();

			unsubscribe();
			walletStore.addAccount();
			expect(listener).not.toHaveBeenCalled();
		});
	});

	describe('get', () => {
		it('returns current state snapshot', () => {
			const walletStore = createBurnerWalletStore();
			walletStore.createWallet();
			walletStore.addAccount();

			const state = walletStore.get();
			expect(state.accountCount).toBe(2);
			expect(state.addresses).toHaveLength(2);
			expect(state.selectedIndex).toBe(1);
			expect(state.selectedAddress).toBe(state.addresses[1]);
		});

		it('returns null mnemonic when no wallet', () => {
			const walletStore = createBurnerWalletStore();
			const state = walletStore.get();
			expect(state.mnemonic).toBeNull();
			expect(state.accountCount).toBe(0);
		});
	});

	describe('localStorage persistence', () => {
		it('loads state from localStorage on creation', () => {
			// Set up localStorage
			const mnemonic =
				'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
			store['burner-wallet:mnemonic'] = mnemonic;
			store['burner-wallet:count'] = '3';
			store['burner-wallet:selected'] = '2';

			const walletStore = createBurnerWalletStore();
			const state = walletStore.get();

			expect(state.mnemonic).toBe(mnemonic);
			expect(state.accountCount).toBe(3);
			expect(state.selectedIndex).toBe(2);
		});

		it('uses custom storage prefix', () => {
			const walletStore = createBurnerWalletStore({
				storagePrefix: 'custom:',
			});
			walletStore.createWallet();

			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'custom:mnemonic',
				expect.any(String)
			);
		});
	});

	describe('address derivation', () => {
		it('derives known addresses from standard test mnemonic', () => {
			const walletStore = createBurnerWalletStore();
			// Standard test mnemonic
			const mnemonic =
				'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
			walletStore.importMnemonic(mnemonic);

			// First account address for this mnemonic (BIP-44 m/44'/60'/0'/0/0)
			// This is a well-known address for this test vector
			const address = walletStore.getAddress(0);
			expect(address.toLowerCase()).toBe(
				'0x9858effd232b4033e47d90003d41ec34ecaeda94'.toLowerCase()
			);
		});
	});
});
